"""Select authorized recipients using clinic-local civil time and the submitted policy."""
from datetime import datetime, timedelta, timezone
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def clinic_zone(name):
    if name in (None, '', 'Asia/Baku'):
        return timezone(timedelta(hours=4))
    if name == 'UTC':
        return timezone.utc
    match = re.fullmatch(r'UTC([+-])(\d\d):(\d\d)', name)
    if match and int(match[2]) <= 14 and int(match[3]) < 60:
        delta = timedelta(hours=int(match[2]), minutes=int(match[3]))
        return timezone(delta if match[1] == '+' else -delta)
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        raise ValueError('Klinikanın saat qurşağı tanınmadı')


def in_window(entry, now):
    def minute(key):
        text = entry.get(key, '00:00')
        if not isinstance(text, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', text):
            raise ValueError('Saat HH:MM formatında olmalıdır')
        return 60 * int(text[:2]) + int(text[3:])
    start, end = minute('start'), minute('end')
    at = now.hour * 60 + now.minute
    day = now.isoweekday()
    if end < start and at < end:
        day = (day - 2) % 7 + 1
    days = entry.get('days') or range(1, 8)
    return day in days and (start == end or (start <= at < end if start < end else at >= start or at < end))


def matching_rule(policy, payload, now):
    for rule in policy.get('rules', []):
        if not rule.get('enabled') or not in_window(rule, now):
            continue
        if all(not rule.get(field) or payload.get(key) in rule[field] for field, key in
               [('modalities','modality'), ('sources','source'), ('aeTitles','aeTitle'), ('devices','device')]):
            return rule
    return None


def select_recipients(mode, payload, policy, members, workloads, now=None):
    eligible = {m['id'] for m in members if m.get('active') and 'receive' in m.get('permissions', [])}
    explicit = payload.get('recipients', [])
    if mode in ('one','many','consult'):
        if not isinstance(explicit,list) or not explicit or any(uid not in eligible for uid in explicit):
            raise ValueError('Qəbul edən radioloqun icazəsi yoxdur')
        if mode == 'one' and len(explicit) != 1 or mode == 'consult' and len(set(explicit)) != 2:
            raise ValueError('Radioloq seçimini yoxlayın')
        return list(dict.fromkeys(explicit))
    eligible.intersection_update(m['id'] for m in members if m.get('role') == 'radiologist')
    if mode == 'all':
        return sorted(eligible)
    if mode not in ('duty', 'auto'):
        raise ValueError('Göndəriş rejimi və qəbul edənlər yoxlanılmalıdır')
    now = (now or datetime.now(timezone.utc)).astimezone(clinic_zone(policy.get('timezone')))
    rule = {}
    if mode == 'auto':
        rule = matching_rule(policy, payload, now)
        if not policy.get('autoEnabled') or rule is None:
            raise ValueError('Uyğun aktiv avtomatik qayda yoxdur')
    on_call = [uid for shift in policy.get('shifts', []) if in_window(shift, now) for uid in shift.get('recipients', [])]
    absent, substitutions = set(), {}
    for exception in policy.get('exceptions', []):
        if exception.get('date') == now.date().isoformat():
            if 'recipients' in exception:
                on_call = exception['recipients']
            absent.update(exception.get('off', []))
            substitutions.update(exception.get('substitutes', {}))
    def available(candidates):
        assigned = (substitutions.get(uid,uid) for uid in candidates)
        return list(dict.fromkeys(uid for uid in assigned if uid in eligible and uid not in absent))
    recipients = available(rule.get('recipients') or on_call) or available(policy.get('fallback', []))
    if not recipients:
        raise ValueError('Növbətçi və ya ehtiyat radioloq tapılmadı. Əl ilə seçin.')
    if rule.get('leastLoaded'):
        return [min(recipients, key=lambda uid: (workloads.get(uid,0),uid))]
    return recipients
