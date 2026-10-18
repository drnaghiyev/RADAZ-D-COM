"""Native actions target only a temporary, unguessable RADAZ window caption."""
import os
import re
import time

_viewers = {}

def minimize_records(token):
    return _activate(token, False)

def maximize_viewer(token):
    return _activate(token, True)

def register_viewer(token):
    return _activate(token, True, register=True)

def register_records(token):
    return _activate(token, False, register=True)

def focus_records(token):
    return _activate(token, False, focus=True)

def maximize_records(token):
    return _activate(token, True, records=True)

def _activate(token, maximize, register=False, focus=False, records=False):
    prefix = "RADAZ_VIEWER_" if maximize and not records else "RADAZ_RECORDS_"
    result = "registered" if register else "focused" if focus else "maximized" if maximize else "minimized"
    if not isinstance(token, str) or not re.fullmatch(prefix + r'[a-f0-9]{32}', token):
        raise ValueError('Pəncərə identifikatoru düzgün deyil')
    if os.name != 'nt':
        return {result: False}
    import ctypes
    from ctypes import wintypes
    user = ctypes.WinDLL('user32', use_last_error=True)
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.SetForegroundWindow.argtypes = [wintypes.HWND]
    user.GetPropW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]
    user.GetPropW.restype = wintypes.HANDLE
    user.SetPropW.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.HANDLE]
    user.IsZoomed.argtypes = [wintypes.HWND]
    user.IsIconic.argtypes = [wintypes.HWND]
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    found = []
    @callback_type
    def visit(hwnd, _):
        text = ctypes.create_unicode_buffer(user.GetWindowTextLengthW(hwnd) + 1)
        user.GetWindowTextW(hwnd, text, len(text))
        # The token is added only to a popup created by our own launcher.
        if user.IsWindowVisible(hwnd) and f'RADAZ [{token}] · ' in text.value:
            found.append(hwnd)
        return True
    deadline = time.monotonic() + 1.5
    while True:
        found.clear()
        # Chromium can postpone caption updates while minimized. Register a
        # native window property while visible; Windows clears it on destruction,
        # so a reused HWND can never select an unrelated browser window.
        cached = _viewers.get(token)
        if cached and user.GetPropW(cached, 'RADAZ:' + token) == 1:
            found.append(cached)
        else:
            _viewers.pop(token, None)
            user.EnumWindows(visit, 0)
        if found:
            for hwnd in found:
                if user.SetPropW(hwnd, 'RADAZ:' + token, 1): _viewers[token] = hwnd
                if register: continue
                if maximize:
                    user.ShowWindowAsync(hwnd, 3)  # SW_MAXIMIZE also restores an iconic Viewer
                    user.SetForegroundWindow(hwnd)
                elif focus:
                    if user.IsIconic(hwnd): user.ShowWindowAsync(hwnd, 9)  # SW_RESTORE
                    user.SetForegroundWindow(hwnd)
                elif not user.IsIconic(hwnd):
                    user.ShowWindowAsync(hwnd, 6)  # Legacy clients only
            return {result: True}
        if time.monotonic() >= deadline: return {result: False}
        time.sleep(.05)
