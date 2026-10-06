package core

import (
	"errors"
	"net/http"
)

type apiError struct {
	status  int
	code    string
	message string
}

func (e *apiError) Error() string { return e.message }

func problem(status int, code string) error {
	return &apiError{status: status, code: code, message: code}
}

func badRequest(code string) error   { return problem(http.StatusBadRequest, code) }
func unauthorized(code string) error { return problem(http.StatusUnauthorized, code) }
func forbidden(code string) error    { return problem(http.StatusForbidden, code) }
func notFound(code string) error     { return problem(http.StatusNotFound, code) }
func conflict(code string) error     { return problem(http.StatusConflict, code) }

func statusFor(err error) (int, string, string) {
	var value *apiError
	if errors.As(err, &value) {
		return value.status, value.code, value.message
	}
	return http.StatusInternalServerError, "internal-error", "Request failed."
}
