"""merge trace_samples + attachments heads

Revision ID: ef524f5c2b91
Revises: 04d6ae9c427c, 9249c3b6dab4
Create Date: 2026-05-24 17:35:33.481623

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ef524f5c2b91'
down_revision: Union[str, Sequence[str], None] = ('04d6ae9c427c', '9249c3b6dab4')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
