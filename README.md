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
- Baza produktów (nazwa + kategoria + wiele kodów kreskowych dla jednego produktu)
- Przy tworzeniu można zeskanować kilka opakowań; przy istniejącym produkcie można dopisać kolejny kod skanerem albo ręcznie
- Dodawanie do koszyka ilości (sumuje, gdy ten sam produkt)
- Eksport tekstu + zapis PDF przez drukowanie (Android/iPhone)
- Eksport zamówienia do skoroszytu Excel z tymi samymi informacjami co PDF
- „Nowe zamówienie” czyści koszyk
- Pole „Twoje imię” (kto dodaje)
- W Bazie produktów ukrywa pozycje już dodane do koszyka
- Widoki Koszyk i Eksport są rozdzielone; Eksport pokazuje tekst i opcje kopiowania/PDF
- Mobilny formularz Bazy układa się w czytelne kolumny, a zoom aparatu startuje na 3× (jeśli kamera to obsługuje)

## Ważne
Ta wersja zapisuje dane w pamięci przeglądarki (localStorage).
Jeśli chcesz, żeby wielu kucharzy miało *wspólne* zamówienie na różnych telefonach,
trzeba dodać backend (np. Firebase/Supabase/Apps Script). Napisz – podeślę wersję „współdzieloną”.

## Automatyczne dopisywanie produktów i kodów do Google Sheets
W ZIP-ie jest plik `sheet-writeback.gs`, przygotowany dla arkusza i zakładki przekazanych przez właściciela. Konfigurację trzeba wykonać jeden raz na koncie Google właściciela arkusza:

1. Otwórz arkusz Google → **Rozszerzenia → Apps Script**.
2. W edytorze wklej zawartość pliku `sheet-writeback.gs` i zapisz.
3. Z listy funkcji wybierz `initializeWriteToken` i kliknij **Uruchom**. Zatwierdź uprawnienia, a potem w dzienniku wykonania skopiuj token (zapisz go prywatnie; ponowne uruchomienie wygeneruje nowy token).
4. Kliknij **Wdróż → Nowe wdrożenie**, wybierz typ **Aplikacja internetowa**, ustaw „Wykonuj jako: Ja”, a dostęp ustaw na **Każdy**. Zatwierdź wymagane uprawnienia Google.
5. Skopiuj adres wdrożenia kończący się na `/exec`.
6. W aplikacji otwórz **Baza produktów → Połącz zapis**. Wklej adres `/exec`, a w kolejnym oknie token z dziennika wykonania.

Po skonfigurowaniu nowe produkty i przypisane kody kreskowe będą trafiać do wskazanej zakładki. Jeśli ten sam produkt (ta sama nazwa i kategoria) już istnieje, skrypt uzupełni jego wiersz. Aplikacja może wysłać dane, gdy telefon jest offline; niewysłane wpisy prześle po ponownym połączeniu.

Przeglądarka nie udostępnia stronie odpowiedzi skryptu Google, dlatego po komunikacie o wysłaniu odśwież arkusz i sprawdź wiersz. Adres wdrożenia i token są zapisane w pamięci aplikacji na danym urządzeniu; skonfiguruj je osobno na każdym telefonie. Plik skryptu nie zawiera tokenu — nie publikuj tokenu z dziennika wykonania.
