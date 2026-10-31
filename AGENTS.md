# Repository Agent Instructions

## Git commit identity

- Preserve the repository owner's existing Git identity as the primary commit author. Do not replace the user's author name or email with Codex's identity.
- Every commit created by Codex must include this final commit-message trailer: `Co-authored-by: Codex <codex@openai.com>`. Put the trailer in the trailer block after a blank line, and preserve any other existing commit-message content and trailers.
