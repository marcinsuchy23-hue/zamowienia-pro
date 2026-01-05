# Zamówienia PRO — PWA (działa na telefonie)

To jest prosta „apka” webowa (PWA) do zbierania zamówień w kuchni.

## Jak uruchomić najprościej (na komputerze)
1. Rozpakuj ZIP.
2. Otwórz `index.html` w przeglądarce.

## Jak zrobić z tego „apkę” na telefonie
Najlepiej wrzucić na hosting (darmowy):
- GitHub Pages
- Netlify
- Cloudflare Pages

### Opcja A — Netlify (najprostsze)
1. Wejdź na Netlify → Add new site → Deploy manually.
2. Przeciągnij cały folder (albo ZIP) do okna.
3. Dostaniesz link do strony.
4. Na telefonie otwórz link → menu przeglądarki → „Dodaj do ekranu głównego”.

### Opcja B — GitHub Pages
1. Załóż repo i wgraj pliki.
2. Settings → Pages → Deploy from branch.
3. Otwórz link na telefonie → „Dodaj do ekranu głównego”.

## Funkcje
- Baza produktów (nazwa + kategoria)
- Dodawanie do koszyka ilości (sumuje, gdy ten sam produkt)
- Eksport tekstu + zapis PDF przez drukowanie (Android/iPhone)
- „Nowe zamówienie” czyści koszyk
- Pole „Twoje imię” (kto dodaje)

## Ważne
Ta wersja zapisuje dane w pamięci przeglądarki (localStorage).
Jeśli chcesz, żeby wielu kucharzy miało *wspólne* zamówienie na różnych telefonach,
trzeba dodać backend (np. Firebase/Supabase/Apps Script). Napisz – podeślę wersję „współdzieloną”.
