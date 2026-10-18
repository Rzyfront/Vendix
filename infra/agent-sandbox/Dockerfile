# Linux QA build ONLY after security review. No Docker compose/prod integration.
# Registry manifest read 2026-10-17; linux/amd64, denoland/deno:distroless-2.9.7.
# This is the BASE digest, NOT the final runtime digest required by the supervisor.
FROM --platform=linux/amd64 denoland/deno@sha256:7f06129434994563daa79855c92b1d20f03a2307c3f17dae6359a48578f19e58

USER 65532:65532
WORKDIR /runtime
COPY --chown=65532:65532 --chmod=0444 runner.ts deno.json deno.lock /runtime/

# No host environment is forwarded. These are fixed, non-secret image constants.
ENV DENO_NO_UPDATE_CHECK=1 DENO_NO_PROMPT=1 NO_COLOR=1

ENTRYPOINT ["/bin/deno"]
CMD ["run", "--no-prompt", "--cached-only", "--frozen", "--no-npm", "--no-remote", "--no-code-cache", "--deny-read", "--deny-write", "--deny-net", "--deny-env", "--deny-run", "--deny-ffi", "--deny-sys", "--deny-import", "--config=/runtime/deno.json", "--lock=/runtime/deno.lock", "/runtime/runner.ts"]
