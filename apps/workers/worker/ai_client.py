from typing import cast

import httpx

from worker.config import settings


def generate_note(prompt: str) -> str:
    # Simplified OpenRouter interaction
    with httpx.Client() as client:
        response = client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "openai/gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()
        return cast("str", data["choices"][0]["message"]["content"])
