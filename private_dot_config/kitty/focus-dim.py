from typing import Any

from kitty.boss import Boss
from kitty.window import Window

FOCUSED_OPACITY = '0.85'
UNFOCUSED_OPACITY = '0.7'


def on_focus_change(boss: Boss, window: Window, data: dict[str, Any]) -> None:
    opacity = FOCUSED_OPACITY if data.get('focused', False) else UNFOCUSED_OPACITY
    boss.call_remote_control(
        window,
        ('set-background-opacity', f'--match=id:{window.id}', opacity)
    )
