"""add rx log entries table

Revision ID: e4a0737b189c
Revises: 93d0e18f86f7
Create Date: 2026-05-19 14:48:33.241374

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e4a0737b189c'
down_revision: str | Sequence[str] | None = '93d0e18f86f7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'rx_log_entries',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('recv_time_ms', sa.BigInteger(), nullable=True),
        sa.Column('snr', sa.Float(), nullable=True),
        sa.Column('rssi', sa.Integer(), nullable=True),
        sa.Column('payload_len', sa.Integer(), nullable=True),
        sa.Column('route_type', sa.Integer(), nullable=True),
        sa.Column('payload_type', sa.Integer(), nullable=True),
        sa.Column('pkt_hash', sa.String(length=64), nullable=True),
        sa.Column('path_hex', sa.String(length=255), nullable=True),
        sa.Column('raw_hex', sa.Text(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('rx_log_entries', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_rx_log_entries_recv_time_ms'),
            ['recv_time_ms'],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f('ix_rx_log_entries_pkt_hash'),
            ['pkt_hash'],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f('ix_rx_log_entries_created_at'),
            ['created_at'],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('rx_log_entries', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_rx_log_entries_created_at'))
        batch_op.drop_index(batch_op.f('ix_rx_log_entries_pkt_hash'))
        batch_op.drop_index(batch_op.f('ix_rx_log_entries_recv_time_ms'))

    op.drop_table('rx_log_entries')
