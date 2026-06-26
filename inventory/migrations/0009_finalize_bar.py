from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0008_backfill_bar'),
    ]

    operations = [
        migrations.AlterField(
            model_name='item',
            name='bar',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='inventory.bar'),
        ),
        migrations.AlterField(
            model_name='movement',
            name='bar',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='movements', to='inventory.bar'),
        ),
        migrations.AlterField(
            model_name='todo',
            name='bar',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='todos', to='inventory.bar'),
        ),
        migrations.AlterField(
            model_name='order',
            name='bar',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='orders', to='inventory.bar'),
        ),
        migrations.AlterField(
            model_name='archive',
            name='bar',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='archives', to='inventory.bar'),
        ),
        migrations.AddConstraint(
            model_name='item',
            constraint=models.UniqueConstraint(fields=['bar', 'name'], name='uniq_item_bar_name'),
        ),
        migrations.AddConstraint(
            model_name='archive',
            constraint=models.UniqueConstraint(fields=['bar', 'day'], name='uniq_archive_bar_day'),
        ),
    ]
