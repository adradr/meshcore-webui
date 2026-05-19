from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field


class ContactImportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    uri: str = Field(min_length=10, max_length=4096)


class FlagsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    starred: bool = False
    tel_l: bool = False
    tel_a: bool = False
