"""add diagnostic_runs table

Revision ID: 9eb9360cecf3
Revises: eae31cfba8ac
Create Date: 2026-05-20 23:16:27.766356

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '9eb9360cecf3'
down_revision: str | Sequence[str] | None = 'eae31cfba8ac'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'diagnostic_runs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('target_pubkey', sa.String(length=64), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('verdict', sa.String(length=64), nullable=False),
        sa.Column('report_json', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('diagnostic_runs', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_diagnostic_runs_target_pubkey'),
            ['target_pubkey'],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f('ix_diagnostic_runs_finished_at'),
            ['finished_at'],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('diagnostic_runs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_diagnostic_runs_finished_at'))
        batch_op.drop_index(batch_op.f('ix_diagnostic_runs_target_pubkey'))

    op.drop_table('diagnostic_runs')
