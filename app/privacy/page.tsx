import Link from "next/link";
export default function Privacy() {
  return (
    <main className="privacy-page">
      <Link href="/" className="brand">
        ludex
      </Link>
      <h1>Your journal, on your terms.</h1>
      <p>
        Ludex stores the library entries, progress, reviews, collections and
        social interactions you choose to create. Progress is private by
        default. Publishing a review, sharing progress, following someone and
        live presence have separate controls.
      </p>
      <h2>Private and public content</h2>
      <p>
        Public shelves and reviews disclose their selected titles and text.
        Friends-only content is available to accepted friends. Blocking
        overrides those relationships. Spoiler rules can conceal details until
        the viewer meets the recorded progress requirements.
      </p>
      <h2>Your data</h2>
      <p>
        Signed-in users can export their journal and request account deletion in
        Settings. Deletion immediately removes account access and public
        visibility while cleanup runs. The local development build uses a SQLite
        database on its host. Cloud storage, backup retention and identity
        configuration must be verified before the invited cloud beta.
      </p>
      <h2>Current foundation</h2>
      <p>
        This build does not send your journal to an AI model or connect
        streaming or gaming accounts. Those optional features require separate
        consent when introduced. Catalog artwork belongs to its source
        providers; the eight-title seed is a development fixture.
      </p>
      <h2>Report a problem</h2>
      <p>
        Use activity options to report content or block an account. A moderator
        can review reports using the restricted workspace. The beta operator
        must provide a support contact before distributing the cloud release.
      </p>
      <Link className="button" href="/settings/">
        Open privacy and account settings
      </Link>
    </main>
  );
}
