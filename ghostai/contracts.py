"""Provider-neutral allowlist and shared result vocabulary.

Adapted conceptually from Robot Core's registered operation contract; no source copied.
"""
from dataclasses import dataclass
from enum import StrEnum


class Status(StrEnum):
    VERIFIED = 'verified_persisted'
    ACCEPTED = 'provider_accepted'
    PENDING = 'pending_confirmation'
    REJECTED = 'rejected'
    FAILED = 'failed'


class Error(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


def strict_object(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise Error('Unexpected or missing fields.')


def bounded_text(value, name, limit=2000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise Error(f'{name} must be non-empty text of at most {limit} characters.')
    return value.strip()


@dataclass(frozen=True)
class Operation:
    operation_id: str
    risk: str
    provider: str
    fields: tuple[str, ...]
    scopes: tuple[str, ...]
    timeout_seconds: int = 5
    verification_strategy: str = 'transactional_read_back'
    idempotency_semantics: str = 'tenant_key_and_exact_proposal'

    def validate(self, arguments):
        strict_object(arguments, self.fields)
        return {key: bounded_text(arguments[key], key, 2000 if key == 'text' else 120)
                for key in self.fields}


OPERATIONS = {
    op.operation_id: op for op in (
        Operation('job.read', 'READ', 'native', ('job_id',), ('assigned', 'all')),
        Operation('business_note.create', 'ROUTINE', 'native', ('job_id', 'text'), ('assigned', 'all')),
        Operation('business_note.list', 'READ', 'native', ('job_id',), ('own', 'assigned', 'all')),
        Operation('service_request.create', 'SENSITIVE', 'fake_crm', ('job_id', 'text'), ('assigned', 'all')),
    )
}
DEFAULT_PERMISSIONS = {
    'job.read': 'assigned', 'business_note.create': 'assigned', 'business_note.list': 'own'
}


def validate_permissions(value):
    if not isinstance(value, dict) or set(value) - OPERATIONS.keys():
        raise Error('Unknown permission. Only registered operations may be granted.')
    for name, scope in value.items():
        if not isinstance(scope, str) or scope not in OPERATIONS[name].scopes:
            raise Error(f'Invalid scope for {name}.')
    return dict(value)


def result(request_id, operation_id, status, data=None, error=None):
    return dict(request_id=request_id, operation_id=operation_id, status=str(status),
                data=data or {}, error=error)
