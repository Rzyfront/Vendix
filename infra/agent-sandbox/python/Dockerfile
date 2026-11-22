# Vex analysis sandbox image (vendix.analysis/v1). Built and pushed by an
# operator pipeline, never on a developer machine.
#
# Base image: official AWS Lambda Python 3.12, pinned by digest. The pipeline
# replaces the placeholder with the digest it resolved and reviewed.
FROM public.ecr.aws/lambda/python:3.12@sha256:<PIN_AT_BUILD>

# Content identity of this build (sha256 over code + lockfile), computed by the
# pipeline. An image cannot contain its own digest, so certification (T53)
# binds this value to the real image digest in certification-report.json.
ARG ANALYSIS_RUNTIME_DIGEST
ENV ANALYSIS_RUNTIME_DIGEST=${ANALYSIS_RUNTIME_DIGEST}

COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
# --require-hashes fails closed: requirements.txt must be regenerated with
# hashes (pip-compile --generate-hashes) by the pipeline before building.
RUN pip install --no-cache-dir --require-hashes -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY handler.py runner.py ${LAMBDA_TASK_ROOT}/
# Code is read-only for the function user; only /tmp is writable at runtime.
RUN chmod -R a-w ${LAMBDA_TASK_ROOT} && chmod 0444 ${LAMBDA_TASK_ROOT}/handler.py ${LAMBDA_TASK_ROOT}/runner.py

CMD ["handler.handler"]
