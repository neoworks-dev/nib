# Attachments

The baseline every harness understands: attached bytes live in the asset store, and the prompt
names them by absolute path, so a harness with no multimodal input can still open the file with
the tools it already has. The transcript records the store id, not the path.

**Cloud cannot load an uploaded audio file.** The `LoadAudio` enum is blind to uploads even
though `LoadImage` sees them, which fails with no signpost. Where that matters, the audio is
generated in-graph and wired by connection instead.

Media that belongs to a board is a different thing entirely: it lives in the vault and is served
from there by path. See [[placements]].
