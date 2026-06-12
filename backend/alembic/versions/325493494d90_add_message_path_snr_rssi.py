"""add message path snr rssi

Revision ID: 325493494d90
Revises: 9eb9360cecf3
Create Date: 2026-05-21 10:44:04.856408

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '325493494d90'
down_revision: str | Sequence[str] | None = '9eb9360cecf3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add per-message radio metadata captured from RX_LOG_DATA correlation."""
    with op.batch_alter_table("messages") as batch:
        batch.add_column(sa.Column("path", sa.String(length=128), nullable=True))
        batch.add_column(sa.Column("snr", sa.Float(), nullable=True))
        batch.add_column(sa.Column("rssi", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("messages") as batch:
        batch.drop_column("rssi")
        batch.drop_column("snr")
        batch.drop_column("path")
