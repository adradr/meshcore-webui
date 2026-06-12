"""add trace_samples table

Revision ID: 04d6ae9c427c
Revises: 325493494d90
Create Date: 2026-05-23 16:12:19.475800

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '04d6ae9c427c'
down_revision: str | Sequence[str] | None = '325493494d90'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the ``trace_samples`` table for the continuous trace monitor."""
    op.create_table(
        'trace_samples',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=False),
        sa.Column('target_pubkey', sa.String(length=64), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('path_len', sa.Integer(), nullable=True),
        sa.Column('snr_there', sa.Float(), nullable=True),
        sa.Column('snr_back', sa.Float(), nullable=True),
        sa.Column('hops_json', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('trace_samples', schema=None) as batch_op:
        batch_op.create_index(
            'ix_trace_samples_session_finished',
            ['session_id', 'finished_at'],
            unique=False,
        )
        batch_op.create_index(
            'ix_trace_samples_target_finished',
            ['target_pubkey', 'finished_at'],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('trace_samples', schema=None) as batch_op:
        batch_op.drop_index('ix_trace_samples_target_finished')
        batch_op.drop_index('ix_trace_samples_session_finished')

    op.drop_table('trace_samples')
