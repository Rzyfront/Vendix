# Vex Code Mode sandbox image (vendix.codemode/v1). NOT DEPLOYED: built and
# pushed only by an operator pipeline, never on a developer machine. Off by
# default in the backend (AI_CODEMODE_SANDBOX_ENABLED) until T69 certifies it.
#
# Base image: official AWS Lambda Node.js 22. The tag is a placeholder: the
# pipeline MUST pin it by digest (FROM ...nodejs:22@sha256:<digest>) at
# certification time (T69) and record the resolved digest.
FROM public.ecr.aws/lambda/nodejs:22

# Content identity of this build (sha256 over code + lockfile), computed by the
# pipeline. An image cannot contain its own digest, so certification (T69)
# binds this value to the real image digest in certification-report.json.
ARG CODEMODE_RUNTIME_DIGEST
ENV CODEMODE_RUNTIME_DIGEST=${CODEMODE_RUNTIME_DIGEST}

COPY package.json package-lock.json ${LAMBDA_TASK_ROOT}/
# Lockfile only, no lifecycle scripts, no dev dependencies.
RUN npm ci --omit=dev --ignore-scripts

COPY handler.cjs runner.cjs ${LAMBDA_TASK_ROOT}/
# Code is read-only for the function user; only /tmp is writable at runtime.
# (The Lambda runtime already runs as a non-root sandbox user; the root FS is
# read-only at execution time.)
RUN chmod -R a-w ${LAMBDA_TASK_ROOT} && chmod 0444 ${LAMBDA_TASK_ROOT}/handler.cjs ${LAMBDA_TASK_ROOT}/runner.cjs

CMD ["handler.handler"]
