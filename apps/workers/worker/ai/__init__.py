"""AI generation worker package.

Logically separated from material processing: this package owns generation
from an AI provider through to validated content persistence. The material
worker consumes the `jobs` queue; the AI worker consumes `ai_generation`.
"""
