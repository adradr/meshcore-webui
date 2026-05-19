"""add mute_preferences

Revision ID: eae31cfba8ac
Revises: e4a0737b189c
Create Date: 2026-05-19 20:50:43.764073

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'eae31cfba8ac'
down_revision: Union[str, Sequence[str], None] = 'e4a0737b189c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'mute_preferences',
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('key', sa.String(length=64), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('kind', 'key'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('mute_preferences')
