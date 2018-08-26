# Google Home/Assistant FHEM Connector

ghome-fhem verbindet FHEM mit Google Assistant und erlaubt dadurch die Nutzung der FHEM Geräte in Verbindung mit jedem Google Assistant fähigem Gerät. Dies ist ein Fork des ursprünglich von yanniks bereitgestellten Repositories. Ein großes Danke für seine Entwicklung!

## Domain registrieren z.B. bei ddnss.de (gratis)
1. Account bei ddnss.de anlegen
2. Autoupdate der IP einrichten
	```
	sudo crontab -e
	39 * * * * /usr/bin/wget -q -O - "https://ddnss.de/upd.php?key=CHANGEME&host=CHANGEME.ddnss.de"
	```

## Zertifikat erstellen
letsencrypt Zertifikat für diesen Host erstellen (unbedingt notwendig, ohne gültiges Zertifikat geht nichts!)
1. Port 80 auf RPi weiterleiten
2. certbot ausführen

## ghome-fhem installieren
1. GitHub repo lokal auschecken ($HOME/ghome)
2. Im Ordner folgende Kommandos ausführen:
```
npm install
ssl zertifikat mit ./createKey.sh erzeugen -> Passwort mindestens 4 stellen, alle Fragen beantworten
```
3. config.json anpassen

$HOME/.ghome/config.json anpassen
```
{
    "ghome": {
        "port": 3000,
        "name": "Google Home",
        "keyFile": "./key.pem",
        "certFile": "./cert.pem",
        "nat-pmp": "",
        "nat-upnp": false,
        "oauthClientId": "CHANGEME34567890asdf45678asdf5678asdf",
                "oauthClientSecret": "CHANGEME567897654345678ghjaskdfhg456",
                "oauthUsers": {
                        "CHANGMEusername": {
                                "password": "CHANGEME456789645678dfizh28gasdf",
                                "authtoken": "CHANGEME768782935487zuaisdpfhgu987g23d"
                        }
                }
    },
    
    "connections": [
        {
            "name": "FHEM",
            "server": "127.0.0.1",
            "port": "8083",
            "webname": "fhem",
            "filter": "room=GoogleHome"
        }
    ]
}
```
	
Bitte passt Benutzername (CHANGEMEusername) und Passwort (password) an, ersetzt auch die Werte von `oauthClientId`, `oauthClientSecret` und `authtoken`, gerne auch duch zufällig generierte Werte. So stellt ihr sicher, dass der Zugang für unbefugte Personen zumindest erschwert wird.

4. letsencrypt Zertifikat kopieren

/etc/letsencrypt/DOMAIN/privkey.pem => $HOME/ghome/ghome-fhem/key.pem

/etc/letsencrypt/DOMAIN/fullchain.pem => $HOME/ghome/ghome-fhem/cert.pem)

5. Port 3000 von außen erreichbar machen

6. bin/ghome starten

## Google Action Projekt erstellen

1. https://console.actions.google.com/ Add/import project auswählen
2. Projektname FHEM-Connector
3. Home Control auswählen
4. Smart home auswählen
5. Overview - Quick Setup
   - Name your Smart Home action: FHEM Connector
   - Add account linking
     - Account creation: No, I only want to allow account creation on my website
     - Linking type: OAuth, Authorization code
     - Client information: ClientID (oauthClientId) und ClientSecret (oauthClientSecret) aus der config.json verwenden
     - Client information: Authorization URL (https://CHANGEME.ddnss.de/oauth), Token URL (https://CHANGEME.ddnss.de/token)
     - Testing instructions: "Schalte das Licht ein" eintragen
6. Overview - Build your Action
   - Add Action - Add your first Action
     - Create smart home action: URL https://CHANGEME.ddnss.de
   - Test Actions in the simulator
     - Testing rechts oben aktivieren, wenn nicht automatisch passiert
7. action.json

Den Inhalt der action.json mit dem Inhalt der action-sample.json aus diesem Ordner ersetzen. `https://SERVICEURL` wird dabei durch die URL ersetzt, unter welcher der Dienst bei euch erreichbar ist.
action.json
```
{
  "actions": [
          {
              "name": "actions.devices",
              "deviceControl": {
              },
              "fulfillment": {
                "conversationName": "automation"
              }
    }
  ],
  "conversations": {
    "automation": {
      "name": "automation",
      "url": "https://CHANGEME.ddnss.de"
    }
  },
  "locale": "de"
}
```
8. gaction ausführen
```
gactions update --action_package action.json --project FHEM-Connector
```
## Google Home App einrichten
In der Google Home-App auf einem Smartphone oder Tablet lässt sich nun im Smart Home-Bereich ein neuer Gerätetyp hinzufügen. In der Liste aller Typen taucht jetzt auch euer eigener auf, er beginnt mit [test].
   
Eventuell müsst ihr euer Konto mehrmals verknüpfen, bei mir hat es nicht immer beim ersten mal geklappt.

## Mögliche Kommandos
* “ok google, schalte <gerät> ein”
* “ok google, schalte das Licht im Raum <raum> aus”
* “ok google, stell die Temperatur in <raum> auf <wert> Grad”
* “ok google, dimme das Licht in Raum <raum> auf <anzahl> Prozent”
* “ok google, wie warm ist es in <raum>?“
* “ok google, ist das Licht in <raum> an?“
