ACHTUNG: in arbeit

1. gratis ddnss.de Host registrieren wenn man noch keine Domain hat

2. letsencrypt Zertifikat für diesen Host erstellen (unbedingt notwendig, ohne gültiges Zertifikat geht nichts!)

	a. Port 80 auf RPi weiterleiten

	b. certbot ausführen

3. ghome-fhem installieren
  GitHub repo lokal auschecken ($HOME/ghome)
  Im Ordner folgende Kommandos ausführen:
  npm install
  ssl zertifikat mit ./createKey.sh erzeugen.
    -> Passwort mindestens 4 stellen, alle Fragen beantworten
  <home>/.ghome/config.json anpassen (siehe config-sample.json)
    Bitte passt Benutzername und Passwort an, ersetzt auch die Werte von `oauthClientId`, `oauthClientSecret` und `authtoken`, gerne auch duch zufällig generierte Werte. So stellt ihr sicher, dass der Zugang für unbefugte Personen zumindest erschwert wird.
  bin/ghome starten

4. letsencrypt Zertifikat nach $HOME/ghome/ghome-fhem kopieren

5. Port 3000 von außen erreichbar machen

6. Google Action erstellen
  Folgender Anleitung folgen: https://developers.google.com/actions/sdk/create-a-project
  Den Inhalt der action.json mit dem Inhalt der action-sample.json aus diesem Ordner ersetzen. `https://SERVICEURL` wird dabei durch die URL ersetzt, unter welcher der Dienst bei euch erreichbar ist.

a. OAuth Setup
	
Damit die Verbindung funktioniert, muss in der Actions on Google Konsole "Account linking" konfiguriert werden. Auf der Overview-Seite eures Assistenten wählt ihr dazu den sechsten Punkt, Account linking (optional), aus.
	Wählt als Grant type "Authorization code" aus, Client ID und Client secret entsprechen den Werten, die in eurer `config.json` unter `oauthClientId` und `oauthClientSecret` stehen.
	Fügt für die Authorization URL and die URL aus dem vorherigen Schritt "/oauth" an, sodass eine URL wie "https://SERVICEURL/oauth" entsteht. Für die Token URL gilt dasselbe Format.
	Schreibt in die Testing instructions irgendwas rein und speichert die Einstellungen.
	
b. Simulator aktivieren
	
Im Menü links "Simulator" aktivieren. Im Menü oben lässt sich nun unter dem Icon, welches den Laptop und das Handy zeigt, "Testing on Device" aktivieren.
	In der Google Home-App auf einem Smartphone oder Tablet lässt sich nun im Smart Home-Bereich ein neuer Gerätetyp hinzufügen. In der Liste aller Typen taucht jetzt auch euer eigener auf, er beginnt mit [test].
	Eventuell müsst ihr euer Konto mehrmals verknüpfen, bei mir hat es nicht immer beim ersten mal geklappt.

7. “ok google, schalte <gerät> ein”
   “ok google, schalte das Licht im Raum <raum> aus”
   “ok google, stell die Temperatur in <raum> auf <wert> Grad”
   “ok google, dimme das Licht in Raum <raum> auf <anzahl> Prozent”
   “ok google, wie warm ist es in <raum>?“
   “ok google, ist das Licht in <raum> an?“
