"""Working-list retention only. Shipping documents and print history are untouched."""
from datetime import datetime, timedelta, timezone

POLICY = 'active-24h-v1'
TZ = timezone(timedelta(hours=8))
DONE_ACTIONS = {'printed', 'print_requested', 'processed', 'shipped'}


def parsed_time(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result.replace(tzinfo=TZ) if result.tzinfo is None else result.astimezone(TZ)
    except (AttributeError, ValueError, TypeError):
        return None


def pending(row, handling=None):
    if handling and handling.get('dismissed'):
        return False
    if row.get('stage') in ('shipped', 'cancelled'):
        return False
    action = handling.get('action') if handling else ''
    if action == 'reopen':
        return True
    if action in DONE_ACTIONS:
        return False
    # Acquiring/arranging a document still requires packing and printing.
    return not row.get('platformPrinted', False)


def visible(row, handling=None, at=None):
    if handling and handling.get('dismissed'):
        return False
    if row.get('stage') in ('shipped', 'cancelled'):
        return False
    if pending(row, handling):
        return True
    if expired(row, at):
        return False
    completed = parsed_time(handling.get('updated')) if handling else None
    # An old platform-printed order without a completion time is not a new job.
    return bool(completed and (at or datetime.now(TZ)) - completed < timedelta(hours=24))


def public_visible(row, at=None):
    if row.get('stage') in ('shipped', 'cancelled'):
        return False
    handled = row.get('handled') and row.get('handlingAction') not in ('acquired', 'arranged', 'reopen')
    if not handled:
        return True
    if expired(row, at):
        return False
    completed = parsed_time(row.get('handledAt'))
    return bool(completed and (at or datetime.now(TZ)) - completed < timedelta(hours=24))


def expired(row, at=None):
    deadline = parsed_time(row.get('shippingDeadlineAt'))
    precision = row.get('shippingDeadlinePrecision')
    if not deadline or not row.get('shippingDeadlineSource') or precision not in ('date','minute'):
        return False
    if precision == 'date':
        deadline = deadline.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return (at or datetime.now(TZ)) >= deadline
