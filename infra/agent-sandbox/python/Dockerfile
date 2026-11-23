# Vex analysis sandbox image (vendix.analysis/v1). Built and pushed by an
# operator, never run with guest code on a developer machine.
#
# Base image: official AWS Lambda Python 3.12, linux/arm64 manifest pinned by
# digest (template.json Architecture defaults to arm64). Changing it re-opens T53.
FROM public.ecr.aws/lambda/python:3.12@sha256:ed196260cbf6f74e3f64dd141ebe2401d78a15e6355925da98a3d3c3b4d35c6a

# Content identity of this build: output of ./runtime-digest.sh (sha256 over
# Dockerfile + lockfile + code + template.json). An image cannot contain its own digest, so
# certification (CERTIFICACION-T53.md) binds this value to the ECR image digest.
ARG ANALYSIS_RUNTIME_DIGEST
ENV ANALYSIS_RUNTIME_DIGEST=${ANALYSIS_RUNTIME_DIGEST}

COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
# --require-hashes fails closed: requirements.txt must be regenerated with
# hashes (pip-compile --generate-hashes) by the pipeline before building.
RUN pip install --no-cache-dir --require-hashes -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY handler.py runner.py ${LAMBDA_TASK_ROOT}/
# Code is read-only for the function user; only /tmp is writable at runtime.
# Execute-only interpreter (T53): Lambda's seccomp denies prctl, so
# PR_SET_DUMPABLE cannot be set. Exec'ing an unreadable binary makes the kernel
# mark the handler AND every child non-dumpable (/proc/<pid> owned by root), so
# the guest cannot read the parent's environ/mem. handler.py verifies it at
# runtime and fails closed otherwise. Must stay the LAST step that runs python.
RUN chmod -R a-w ${LAMBDA_TASK_ROOT} && chmod 0444 ${LAMBDA_TASK_ROOT}/handler.py ${LAMBDA_TASK_ROOT}/runner.py \
    && chmod 0711 /var/lang/bin/python3.12

CMD ["handler.handler"]
