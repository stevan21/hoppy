from django import forms
from django.contrib.auth.models import User
from django.utils.text import slugify

from .models import Bar, Profile


class GerantSignupForm(forms.Form):
    """Inscription d'un gérant : crée son compte, son établissement et son profil."""
    bar_name = forms.CharField(label="Nom de l'établissement", max_length=120)
    type = forms.ChoiceField(label="Type d'établissement", choices=Bar.TYPE_CHOICES, initial="bar", required=False)
    email = forms.EmailField(label="Email")
    password1 = forms.CharField(label="Mot de passe", widget=forms.PasswordInput, min_length=6)
    password2 = forms.CharField(label="Confirmer le mot de passe", widget=forms.PasswordInput)

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(username__iexact=email).exists():
            raise forms.ValidationError("Un compte existe déjà avec cet email.")
        return email

    def clean(self):
        cleaned = super().clean()
        p1, p2 = cleaned.get("password1"), cleaned.get("password2")
        if p1 and p2 and p1 != p2:
            self.add_error("password2", "Les mots de passe ne correspondent pas.")
        return cleaned

    def _unique_slug(self, name):
        base = slugify(name) or "bar"
        slug = base
        i = 2
        while Bar.objects.filter(slug=slug).exists():
            slug = f"{base}-{i}"
            i += 1
        return slug

    def save(self):
        email = self.cleaned_data["email"]
        bar = Bar.objects.create(
            name=self.cleaned_data["bar_name"].strip(),
            slug=self._unique_slug(self.cleaned_data["bar_name"]),
            type=self.cleaned_data.get("type") or "bar",
        )
        user = User.objects.create_user(username=email, email=email, password=self.cleaned_data["password1"])
        Profile.objects.create(user=user, bar=bar, role="gerant")
        return user


class BarSettingsForm(forms.ModelForm):
    """Réglages de l'établissement : nom + type (modifiable par le gérant)."""
    class Meta:
        model = Bar
        fields = ["name", "type"]
        labels = {"name": "Nom de l'établissement", "type": "Type d'établissement"}


class ServeurForm(forms.Form):
    """Création d'un serveur par le gérant (accès caisse uniquement)."""
    username = forms.CharField(label="Identifiant du serveur", max_length=120)
    password = forms.CharField(label="Mot de passe", widget=forms.PasswordInput, min_length=4)

    def clean_username(self):
        username = self.cleaned_data["username"].strip()
        if User.objects.filter(username__iexact=username).exists():
            raise forms.ValidationError("Cet identifiant est déjà pris.")
        return username

    def save(self, bar):
        user = User.objects.create_user(
            username=self.cleaned_data["username"],
            password=self.cleaned_data["password"],
        )
        Profile.objects.create(user=user, bar=bar, role="serveur")
        return user
