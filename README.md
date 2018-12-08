# Google Home/Assistant FHEM Connector

ghome-fhem ist ein eigenständig gestartetes Programm, das eine vom Google-Assistant aufgerufenen Webschnittstelle bereitstellt und die darüber empfangenen Befehle in natürlicher Sprache als fhem Befehle an fhem weiterleitet. Es ermöglicht damit die Nutzung der FHEM Geräte in Verbindung mit jedem Google Assistant fähigem Gerät (Google Home, Handy mit Google Assistant, Smartwatch mit WearOS, usw.). Dies ist ein Fork des ursprünglich von yanniks bereitgestellten Repositories. Ein großes Danke für seine Entwicklung!

## Vorbereitende Arbeiten

1. Sicherung der aktuellen Installation. Beim Raspberry die SD-Karte, ansonsten Backup zum System passend. 

2. Fehlende Pakete installieren. Je nach Distribution können Pakete fehlen. 
```
sudo apt-get -qq install  git

#pwgen - optional zum generieren von Passwörtern
sudo apt-get -qq install pwgen 

sudo apt-get -qq install curl

#NPM installieren -- Achtung, sudo curl bis sudo -E bash - ist eine Zeile
sudo curl -sL https://deb.nodesource.com/setup_8.x | sudo -E bash -
sudo apt-get -qq install nodejs
```

3. Ein (Test)-Gerät in Fhem (>= Version 5.9!!!) dem GoogleHome Raum hinzufügen
In FHEM ein Gerät dem Google Home Raum zuordnen. Über den Raum erfolgt später die Filterung der von ghome-fhem angesteuerten Geräte. Es werden nur Geräte erkannt, die diesem Raum (GoogleHome) zugeordnet sind. 

```
attr Kaffeemaschine room GoogleHome
```

userattr genericDeviceType in FHEM anlegen
```
attr global userattr genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock
```

den zu schaltenden Devices das Attribut genericDeviceType zuordnen

```
attr Kaffeemaschine genericDeviceType switch
```

Die Geräte können über den Devicename, den im alias Attribut definierten Namen oder einem in der Google Home App hinterlegten Spitznamen bei der Steuerung verwendet werden. Ich empfehle hier das alias Attribut zu verwenden und nicht die Spitznamen in der Google Home App. Das erspart Arbeit wenn man die Geräte einmal komplett neu synchronisiert.




## Passwörter und Benutzernamen (mit pwgen) erstellen

Im Beispiel wird pwgen verwendet. Es kann auch jeder Passwortgenerator online verwendet werden.

| Feldame in der Anleitung | pwgen Befehl | Beispiel |
|---|---|---|
|<change_me___oauthClientId>|pwgen -N 1 -s 42   |  m5taWv7ZSZL9ROJ3D1wY12s9V6VKckkluHtdKMxQsd |
|<change_me___oauthClientSecret>|pwgen -N 1 -s 42   |G9T0TKc0qdrzWwYHurecO0IZYUf93qB80nJPZ4XAcx   |
|<change_me___oauthUser>|pwgen -N 1 -s 8   | wDgsn36x|
|<change_me___password>|pwgen -N 1 -s 42   | WqoHFS0FzNzeEfPPwvC5gRAnZCt5vvM8LVEF3aL4LQ  |
|<change_me___authtoken>| pwgen -N 1 -s 42  | agUACUoaCFQt2qFLcKzY2J0FDAOyIcjsGcOckpVBEo  |


## Domain registrieren z.B. bei ddnss.de (gratis)
1. Account bei ddnss.de anlegen
2. Autoupdate der IP einrichten
```
	sudo crontab -e
	39 * * * * /usr/bin/wget -q -O - "https://ddnss.de/upd.php?key=CHANGEME&host=CHANGEME.ddnss.de"
```

2. Alternativ kann den Update der IP auch der Router übernehmen wenn er diese Funktion bietet (z. B. Fritzbox). Anleitungen bieten die Anbieter des dyndns-Dienstes (FAQ).

Diese Domain wird in nachfolgender Anleitung <change_me__domain> genannt.

## Google Action Projekt erstellen

Hierfür werden die ersten beiden Werte (Hashwerte) von oben benötigt 

| Feldame in der Anleitung | pwgen Befehl | Beispiel |
|---|---|---|
|<change_me___oauthClientId>|pwgen -N 1 -s 42   |  m5taWv7ZSZL9ROJ3D1wY12s9V6VKckkluHtdKMxQsd |
|<change_me___oauthClientSecret>|pwgen -N 1 -s 42   |G9T0TKc0qdrzWwYHurecO0IZYUf93qB80nJPZ4XAcx   |

Screenshots der einzelnen Schritte im "doc"-Ordner ([Google_Actions.docx](docs/Google_Actions.docx))

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


## Zertifikat erstellen

Wenn bereits Zertifikate vorhanden sind können diese verwendet werden. Ansonsten können diese mit Letsencrypt erstellt werden.

Letsencrypt installieren

 1. Source zu apt hinzufügen

```
echo "deb http://ftp.debian.org/debian stretch-backports main" | sudo tee -a /etc/apt/sources.list.d/letsencrypt.list
sudo apt-get -qq update
```

 2. Eigentliche Installation
 
```
sudo apt-get -qq install certbot
```

letsencrypt Zertifikat für diesen Host erstellen (unbedingt notwendig, ohne gültiges Zertifikat geht nichts!)
1. Port 80 auf RPi weiterleiten. Das muss am Router (z. B. Fritzbox) gemacht werden. Hierzu den externen Port 80 zum internen Port 80 auf den Raspberry weiterleiten. < Internet > -->Port 80--> < Router > -->Port 80--> < Raspberry >
2. certbot ausführen und Fragen beantworten. Der Parameter "--standalone" startet einen eigenen, temporären Webserver. Wenn nginx oder apache auf dem Server läuft diesen entweder beenden, oder certbot für den entsprechenden Webserver aufrufen. Anleitungen hierzu auf der Herstellerseite https://certbot.eff.org/lets-encrypt/ubuntuxenial-nginx.html
```
sudo certbot certonly --standalone --agree-tos
```
Fragen bestätigen bzw. Informationen eintragen. Hier wird auch die <change_me___domain> benötigt.

3. Port 80 Weiterleitung entfernen
4. Bei jedem Zertifikatsrenew (certbot renew) muss Port 80 wieder weitergeleitet werden (alle 3 Monate)

https://certbot.eff.org/lets-encrypt/debianstretch-other

## ghome-fhem installieren
1. GitHub repo lokal auschecken

```
cd $HOME
git clone https://github.com/dominikkarall/ghome-fhem
```

Jetzt sollte es Ordner /home/pi/ghome-fhem mit dem Inhalt des Git-Projektes geben. Wenn das Setup nicht mit dem User pi ist der Username "pi" durch den enstsprechenden Namen zu ersetzen.

2. Im Ordner folgendes Kommando ausführen:
```
cd $HOME/ghome-fhem
npm install
```
3. config.json kopieren
```
cd $HOME
mkdir .ghome
cp ghome-fhem/config-sample.json .ghome/config.json
```

4. /home/pi/.ghome/config.json anpassen

Im Beispiel alle <change_me__xxxx> durch generierte Zeichenfolge ersetzen. So stellt ihr sicher, dass der Zugang für unbefugte Personen zumindest erschwert wird.

```
{
    "ghome": {
        "port": 3000,
        "name": "Google Home",
        "keyFile": "/home/pi/.ghome/key.pem",
        "certFile": "/home/pi/.ghome/cert.pem",
        "nat-pmp": "",
        "nat-upnp": false,
        "oauthClientId": "<change_me___oauthClientId>",
                "oauthClientSecret": "<change_me___oauthClientSecret>",
                "oauthUsers": {
                        "<change_me___oauthUser>": {
                                "password": "<change_me___password>",
                                "authtoken": "<change_me___authtoken>"
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

Mit den Beispielwerten von oben würde die Datei so aussehen ... 
```
{
    "ghome": {
        "port": 3000,
        "name": "Google Home",
        "keyFile": "/home/pi/.ghome/key.pem",
        "certFile": "/home/pi/.ghome/cert.pem",
        "nat-pmp": "",
        "nat-upnp": false,
        "oauthClientId": "m5taWv7ZSZL9ROJ3D1wY12s9V6VKckkluHtdKMxQsd",
                "oauthClientSecret": "G9T0TKc0qdrzWwYHurecO0IZYUf93qB80nJPZ4XAcx",
                "oauthUsers": {
                        "wDgsn36x": {
                                "password": "WqoHFS0FzNzeEfPPwvC5gRAnZCt5vvM8LVEF3aL4LQ",
                                "authtoken": "agUACUoaCFQt2qFLcKzY2J0FDAOyIcjsGcOckpVBEo"
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


4. letsencrypt Zertifikat kopieren
```
cd $HOME/.ghome
sudo cp /etc/letsencrypt/live/<change_me___domain>/privkey.pem $HOME/.ghome/key.pem
sudo cp /etc/letsencrypt/live/<change_me___domain/fullchain.pem $HOME/.ghome/cert.pem
sudo chown pi *.pem
```

Hinweis: Bei jeder Erneuerung der Zertifikate müssen diese wieder in /home/pi/.ghome kopiert werden.


4b. letencrypt Zertifikate ohne kopieren einbinden


<<<<--A L T E R N A T I V--Z U--4 >>>>

Linux know-how nötig

Hierzu nur ein paar Ansätze .. es ist empfohlen in diesem Falle ghome unter einem eigenen User (nicht pi) zu starten.

Annahme:
 - User unter dem ghome läuft   ghomeusr
 - Gruppe nur für den lesenden Zugriff auf die Zertifikate    lecert

```
#Gruppe für Letsencrypt
sudo addgroup lecert

#ghome-User der Gruppe zuweisen
usermod -a -G lecert ghomeUsr

#Gruppe setzen
chown -R root:lecert /etc/letsencrypt/

#Letsencrypt der Gruppe lecert erlauben (lesen)
chmod g+r -R /etc/letsencrypt/
```

Einschränkung des Users ghomeUsr 
- normaler User
- kein, oder eingeschränkte sudo
- kein passwort (logon nicht möglich)
- keine Shell hinterlegt (/bin/false, somit auch kein su)

Vorteil: Zertifikat muss beim Erneuern nicht jedes mal kopiert werden.

In der config.json müssen dann die Zeilen "keyFile" und "certFile" angepasst werden.
```
        "keyFile": "/etc/letsencrypt/<change_me__domain>/privkey.pem" ,
        "certFile": "/etc/letsencrypt/<change_me__domain>/fullchain.pem",
```

<<<< A L T E R N A T I V--Z U--4   ----   E N D E >>>>

5. Frontend mit folgenden Befehlen installieren

```
cd $HOME/ghome-fhem/frontend
sudo npm install -g bower
bower install
cd ..
```

6. Port 443 (extern) auf 3000 (intern, auf Raspberry oder Server) weiterleiten. Auch das muss wieder am Router gemacht werden. Hier ist zu beachten, dass sich externer und interner Port unterscheidet.

7. Systemd Dienst einrichten

```
cd $HOME
sudo cp ghome-fhem/ghome-sample.service /lib/systemd/system/ghome.service
```

Inhalt des Scripts (bereits vorhanden). Wenn ghome unter einem anderen User laufen soll, muss pi durch den Usernamen ersetzt werden (3 mal enthalten)
```
[Unit]
Description=Google Assistant FHEM Connector
After=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/ghome/ghome-fhem
ExecStart=/home/pi/ghome/ghome-fhem/bin/ghome
Restart=on-failure

[Install]
WantedBy=multi-user.target
Alias=ghome.service
```

Service aktivierte damit ghome bei einem Systemstart mitgestartet wird
```
sudo systemctl enable ghome.service
```

Testen mit start (starten), stop (stoppen), status (Status wird angezeigt. Wenn der Diest läuft sollte ein grüner Punkt vor dem Prozess sein)

```
sudo systemctl start ghome
sudo systemctl status ghome
sudo systemctl stop ghome
```
 
## Google action und lokalen Server bekannt machen

Den Inhalt der action.json kopieren und   <change_me__domainname>  durch die Domain die registriert wurde ersetzen (im Beispiel ddnss.de). Unter welcher der Dienst bei euch erreichbar ist.

action.json kopieren
```
cd $HOME
cp ghome-fhem/action-sample.json .ghome/action.json
```

Inhalt von .ghome/action.json anpassen - <change_me__domain>
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
      "url": "<change_me__domain>"
    }
  },
  "locale": "de"
}
```
8. gactions downloaden und ausführen

Download von hier: https://developers.google.com/actions/tools/gactions-cli

In diesem Codeblock wird die ARM Version (Raspberry) mit wget heruntergeladen.
<change_me_project_ID> ist der technische Name der Action bei Google. Letze Seite im Word Dokument (doc/Google_Actions.docx)
```
cd $HOME/.ghome
wget -c https://dl.google.com/gactions/updates/bin/linux/arm/gactions
chmod +x gactions
./gactions update --action_package action.json --project <change_me__google_project_ID>
```

Verknüpfung bestätigen

```
pi@debian964:~/.ghome$ ./gactions update --action_package action.json --project fhem-connector-a99ds
Gactions needs access to your Google account. Please copy & paste the URL below into a web browser and follow the instructions there. Then copy and paste the authorization code from the browser back here.
Visit this URL:
 https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=257807841406-o6vu1tgkq8oqjub8jilj6vuc396e2d4d.apps.googleusercontent.com&redirect_uri=urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Factions.builder&state=state
Enter authorization code:
```

Link in einem Browser öffnen. Zugriff von actions.cli auf Google-Account erlauben.

Es erscheint eine Erfolgsmeldung und der authorization code (Beispiel: 4/TAcdJS4FZJw9J_5V0SKrGYdhi67e5t8fVZvujgdaJg2-9a_AP-8OiTa

Diesen in der Konsole bei "Enter authorization code:" eintragen.

Erfolgsmeldung

"Your app for the Assistant for project fhem-connector-940ff was successfully updated with your actions."

Fertig.

Bei Fehler kann folgendes geprüft werden:

- Zeritifikat gültig: https://<replace_me___domain> im Browser öffnen. Neben dem Link sollte ein grünes Schloss (je nach Browser) erscheinen. Wenn statt dessen eine Zertifikatswarnung erscheint --> Zertifikatsproblem 

- Richtige project_id eingetragen?


## Google Home App einrichten
In der Google Home-App auf einem Smartphone oder Tablet lässt sich nun im Smart Home-Bereich ein neuer Gerätetyp hinzufügen. In der Liste aller Typen taucht jetzt auch euer eigener auf, er beginnt mit [test].
   
Eventuell müsst ihr euer Konto mehrmals verknüpfen, bei mir hat es nicht immer beim ersten mal geklappt.

Login 

<change_me___oauthUser>

<change_me___password>

Accounts now linked.


## Mögliche Kommandos
* "ok google, synchronisiere meine Geräte" - Damit werden neu hinzugefügte Geräte in Google Assistant erkannt.
* “ok google, schalte <gerät> ein”
* “ok google, schalte das Licht im Raum <raum> aus”
* “ok google, stell die Temperatur in <raum> auf <wert> Grad”
* “ok google, dimme das Licht in Raum <raum> auf <anzahl> Prozent”
* “ok google, wie warm ist es in <raum>?“
* “ok google, ist das Licht in <raum> an?“
