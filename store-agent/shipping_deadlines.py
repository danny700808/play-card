"""Normalize a deadline explicitly labelled by the platform; never infer SLA."""
import re
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=8))


def deadline_fields(value, verified_at, source):
    if not isinstance(value, str) or not value.strip() or len(value) > 100:
        return {}
    value = value.strip()
    if re.search(r'[\x00-\x1f<>]', value):
        return {}
    try:
        verified = datetime.fromisoformat(verified_at)
        if verified.tzinfo is None:
            return {}
    except (TypeError, ValueError):
        return {}
    result = {'shippingDeadlineText': value, 'shippingDeadlineSource': source,
              'shippingDeadlineVerifiedAt': verified_at}
    # Resolve explicit relative calendar days only against this observation.
    relative = re.fullmatch(r'(今天|今日|明天|明日)(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?(?:\s*前)?', value)
    if relative:
        day = verified.astimezone(TZ).date() + timedelta(days=int(relative[1] in ('明天', '明日')))
        value = day.isoformat() + (' ' + relative[2] if relative[2] else '')
        result['shippingDeadlineText'] = value + '（平台原文：' + result['shippingDeadlineText'] + '）'
    match = re.fullmatch(r'(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s*前)?', value)
    if not match:
        return result  # Preserve source text, but do not invent a sortable instant.
    try:
        parts = [int(p or 0) for p in match.groups()]
        at = datetime(*parts, tzinfo=TZ)
    except ValueError:
        return result
    result.update(shippingDeadlineAt=at.isoformat(timespec='seconds'),
                  shippingDeadlinePrecision='minute' if match[4] is not None else 'date')
    return result
