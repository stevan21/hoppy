from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from inventory.views import archive_day


class Command(BaseCommand):
    help = "Archive l'historique d'une journée (par défaut aujourd'hui). À planifier en fin de journée."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yesterday", action="store_true",
            help="Archiver la journée d'hier au lieu d'aujourd'hui.",
        )

    def handle(self, *args, **options):
        day = timezone.localdate()
        if options["yesterday"]:
            day = day - timedelta(days=1)
        arch = archive_day(day)
        self.stdout.write(self.style.SUCCESS(
            f"Archive {day} : {arch.movements_count} mouvements, "
            f"+{arch.total_in} entrées, -{arch.total_out} sorties, "
            f"ventes {arch.sales_value} XAF."
        ))
