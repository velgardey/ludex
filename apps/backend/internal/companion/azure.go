package companion

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
)

const maxAzureResponseBytes = 2 << 20

type wireReply struct {
	Text      string       `json:"text"`
	Citations []string     `json:"citations"`
	Actions   []wireAction `json:"actions"`
}

type wireAction struct {
	Label   string `json:"label"`
	Summary string `json:"summary"`
	Command string `json:"command"`
}

type azureUsage struct {
	InputTokens      int `json:"input_tokens"`
	OutputTokens     int `json:"output_tokens"`
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

func (u azureUsage) values() (int, int, error) {
	input, output := u.InputTokens, u.OutputTokens
	if input == 0 {
		input = u.PromptTokens
	}
	if output == 0 {
		output = u.CompletionTokens
	}
	if input < 0 || output < 0 || (input == 0 && output == 0) {
		return 0, 0, errors.New("Azure response did not include usable token usage")
	}
	return input, output, nil
}

type azureResponseEnvelope struct {
	OutputText string `json:"output_text"`
	Output     []struct {
		Type    string `json:"type"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"output"`
	Usage azureUsage `json:"usage"`
}

type azureInputMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type responsesRequest struct {
	Model           string              `json:"model"`
	Input           []azureInputMessage `json:"input"`
	MaxOutputTokens int                 `json:"max_output_tokens"`
	Reasoning       struct {
		Effort string `json:"effort"`
	} `json:"reasoning"`
	Text struct {
		Format struct {
			Type   string         `json:"type"`
			Name   string         `json:"name"`
			Strict bool           `json:"strict"`
			Schema map[string]any `json:"schema"`
		} `json:"format"`
	} `json:"text"`
}

type embeddingsRequest struct {
	Model          string   `json:"model"`
	Input          []string `json:"input"`
	EncodingFormat string   `json:"encoding_format"`
}

type embeddingsEnvelope struct {
	Data []struct {
		Index     int       `json:"index"`
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
	Usage azureUsage `json:"usage"`
}

func (s *Service) callResponses(ctx context.Context, userID, requestID, systemPrompt string, prior []Message, userText string) (wireReply, error) {
	input, err := makeResponsesInput(systemPrompt, prior, userText, s.cfg.Limits.MaxContextTokens)
	if err != nil {
		return wireReply{}, err
	}
	reservationID, err := s.budget.reserve(ctx, userID, requestID, "responses", s.cfg.Limits.MaxContextTokens, s.cfg.Limits.MaxOutputTokens, s.cfg.Limits.ResponsesInputMicrosPerMillion, s.cfg.Limits.ResponsesOutputMicrosPerMillion)
	if err != nil {
		return wireReply{}, err
	}
	body := responsesRequest{
		Model:           s.cfg.AzureDeployment,
		Input:           input,
		MaxOutputTokens: s.cfg.Limits.MaxOutputTokens,
	}
	body.Reasoning.Effort = "low"
	body.Text.Format.Type = "json_schema"
	body.Text.Format.Name = "ludex_companion_reply"
	body.Text.Format.Strict = true
	body.Text.Format.Schema = replySchema()
	encoded, err := json.Marshal(body)
	if err != nil {
		return wireReply{}, err
	}
	var response azureResponseEnvelope
	if err := s.azureJSON(ctx, "/responses", encoded, &response); err != nil {
		// A timeout or transport failure may still have been billed. Keep the full
		// reservation until the daily window rolls over.
		return wireReply{}, err
	}
	inputTokens, outputTokens, err := response.Usage.values()
	if err != nil {
		return wireReply{}, err
	}
	if err := s.budget.finalize(ctx, reservationID, inputTokens, outputTokens, s.cfg.Limits.ResponsesInputMicrosPerMillion, s.cfg.Limits.ResponsesOutputMicrosPerMillion); err != nil {
		return wireReply{}, err
	}
	text := strings.TrimSpace(response.OutputText)
	if text == "" {
		for _, item := range response.Output {
			if item.Type != "message" {
				continue
			}
			for _, content := range item.Content {
				if content.Type == "output_text" || content.Type == "text" {
					text = strings.TrimSpace(content.Text)
					if text != "" {
						break
					}
				}
			}
			if text != "" {
				break
			}
		}
	}
	if text == "" {
		return wireReply{}, errors.New("Azure response contained no assistant text")
	}
	var reply wireReply
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&reply); err != nil {
		return wireReply{}, fmt.Errorf("decode assistant response JSON: %w", err)
	}
	if decoder.Decode(new(any)) == nil {
		return wireReply{}, errors.New("assistant response contained trailing JSON data")
	}
	if len(reply.Actions) > 8 || len(reply.Citations) > 12 {
		return wireReply{}, errors.New("assistant response exceeded structured output limits")
	}
	if strings.TrimSpace(reply.Text) == "" || len(reply.Text) > 12000 {
		return wireReply{}, errors.New("assistant response text was empty or too long")
	}
	return reply, nil
}

func (s *Service) callEmbeddings(ctx context.Context, userID, requestID string, inputs []string) ([][]float64, error) {
	if len(inputs) == 0 || len(inputs) > s.cfg.Limits.MaxLibraryRecords+1 {
		return nil, errors.New("invalid assistant embedding batch size")
	}
	if s.cfg.EmbeddingDeployment == "" || !s.budget.embeddingsEnabled() {
		return nil, ErrAllowanceUnavailable
	}
	inputTokens := 0
	for _, input := range inputs {
		inputTokens += estimatedBytesTokens(input)
	}
	if inputTokens <= 0 || inputTokens > s.cfg.Limits.MaxContextTokens {
		return nil, errors.New("assistant embedding input exceeds configured context limit")
	}
	reservationID, err := s.budget.reserve(ctx, userID, requestID, "embeddings", inputTokens, 0, s.cfg.Limits.EmbeddingMicrosPerMillion, 0)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(embeddingsRequest{Model: s.cfg.EmbeddingDeployment, Input: inputs, EncodingFormat: "float"})
	if err != nil {
		return nil, err
	}
	var response embeddingsEnvelope
	if err := s.azureJSON(ctx, "/embeddings", encoded, &response); err != nil {
		return nil, err
	}
	inputTokensUsed, _, err := response.Usage.values()
	if err != nil {
		return nil, err
	}
	if err := s.budget.finalize(ctx, reservationID, inputTokensUsed, 0, s.cfg.Limits.EmbeddingMicrosPerMillion, 0); err != nil {
		return nil, err
	}
	if len(response.Data) != len(inputs) {
		return nil, errors.New("Azure embeddings response count did not match request")
	}
	vectors := make([][]float64, len(inputs))
	for _, item := range response.Data {
		if item.Index < 0 || item.Index >= len(vectors) || len(item.Embedding) == 0 {
			return nil, errors.New("Azure embeddings response contained invalid vector")
		}
		vectors[item.Index] = item.Embedding
	}
	for _, vector := range vectors {
		if len(vector) == 0 {
			return nil, errors.New("Azure embeddings response omitted a vector")
		}
	}
	return vectors, nil
}

func (s *Service) azureJSON(ctx context.Context, suffix string, body []byte, target any) error {
	endpoint, err := azureEndpoint(s.cfg.AzureEndpoint, suffix)
	if err != nil {
		return err
	}
	requestCtx, cancel := context.WithTimeout(ctx, s.cfg.RequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("api-key", s.cfg.AzureAPIKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("Azure request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Azure returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxAzureResponseBytes+1))
	if err != nil {
		return fmt.Errorf("read Azure response: %w", err)
	}
	if len(data) > maxAzureResponseBytes {
		return errors.New("Azure response exceeded size limit")
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("decode Azure response: %w", err)
	}
	return nil
}

func azureEndpoint(base, suffix string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(base))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("Azure endpoint is invalid")
	}
	if parsed.Scheme != "https" && !isLoopbackURL(parsed) {
		return "", errors.New("Azure endpoint must use HTTPS")
	}
	path := strings.TrimRight(parsed.Path, "/")
	trimmed := strings.TrimLeft(suffix, "/")
	if !strings.HasSuffix(path, "/"+trimmed) {
		path += "/" + trimmed
	}
	parsed.Path = path
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func isLoopbackURL(parsed *url.URL) bool {
	if parsed.Scheme != "http" {
		return false
	}
	host := parsed.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func makeResponsesInput(systemPrompt string, prior []Message, current string, maxTokens int) ([]azureInputMessage, error) {
	if maxTokens <= 0 {
		return nil, errors.New("assistant context limit is not configured")
	}
	input := []azureInputMessage{{Role: "system", Content: systemPrompt}}
	for _, message := range prior {
		if message.Role != "user" && message.Role != "assistant" {
			continue
		}
		input = append(input, azureInputMessage{Role: message.Role, Content: message.Text})
	}
	input = append(input, azureInputMessage{Role: "user", Content: current})
	for tokenEstimate(input) > maxTokens && len(input) > 2 {
		input = append(input[:1], input[2:]...)
	}
	if tokenEstimate(input) > maxTokens {
		return nil, errors.New("assistant input exceeds configured context limit")
	}
	return input, nil
}

func tokenEstimate(messages []azureInputMessage) int {
	total := 0
	for _, message := range messages {
		total += estimatedBytesTokens(message.Role) + estimatedBytesTokens(message.Content)
	}
	return total
}

// UTF-8 bytes are a conservative upper bound on the number of tokenizer pieces.
func estimatedBytesTokens(text string) int { return len(text) }

func replySchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"text", "citations", "actions"},
		"properties": map[string]any{
			"text": map[string]any{"type": "string", "maxLength": 12000},
			"citations": map[string]any{
				"type": "array", "maxItems": 12,
				"items": map[string]any{"type": "string", "maxLength": 256},
			},
			"actions": map[string]any{
				"type": "array", "maxItems": 8,
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"label", "summary", "command"},
					"properties": map[string]any{
						"label":   map[string]any{"type": "string", "maxLength": 120},
						"summary": map[string]any{"type": "string", "maxLength": 500},
						"command": map[string]any{"type": "string", "maxLength": 4000},
					},
				},
			},
		},
	}
}
