/**
 * Préparateur de visite : déclencheur Google Agenda.
 *
 * Dès qu'un événement est créé, modifié ou supprimé dans votre agenda principal, ce script envoie
 * à l'application la liste à jour de vos rendez-vous des 21 prochains jours (titre, début, fin, lieu),
 * à votre application, par une adresse privée. Aucune lecture par Claude : l'application l'affiche en quelques secondes.
 *
 * Installation (une seule fois) :
 *   1. https://script.google.com → Nouveau projet → collez ce code à la place du contenu.
 *   2. En haut, choisissez la fonction « installer » puis cliquez sur ▶ Exécuter.
 *   3. Autorisez l'accès à votre agenda (Google affiche un avertissement : Paramètres avancés → Accéder au projet).
 * C'est tout : la liste est envoyée tout de suite, puis à chaque changement.
 */

const ADRESSE = '{{ADRESSE_AGENDA}}';      // adresse privée de votre application (ne pas partager)
const JOURS = 21;

function installer() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t)); // pas de doublon si on relance
  ScriptApp.newTrigger('surChangement')
    .forUserCalendar(Session.getEffectiveUser().getEmail())
    .onEventUpdated()
    .create();
  envoyer('installation');
}

function surChangement(e) {
  envoyer('changement');
}

function envoyer(raison) {
  const agenda = CalendarApp.getDefaultCalendar();
  const fuseau = agenda.getTimeZone();
  const debut = new Date();
  debut.setHours(0, 0, 0, 0);
  const fin = new Date(debut.getTime() + JOURS * 24 * 3600 * 1000);
  const f = (d) => Utilities.formatDate(d, fuseau, "yyyy-MM-dd'T'HH:mm:ss");
  const evenements = agenda.getEvents(debut, fin)
    .filter((ev) => !ev.isAllDayEvent())
    .map((ev) => ({
      id: ev.getId().split('@')[0],
      titre: (ev.getTitle() || '').slice(0, 120),
      debut: f(ev.getStartTime()),
      fin: f(ev.getEndTime()),
      lieu: (ev.getLocation() || '').slice(0, 120),
    }));
  const message = JSON.stringify({ type: 'agenda', raison: raison, genere: f(new Date()), debut: f(debut), jours: JOURS, evenements: evenements });
  const reponse = UrlFetchApp.fetch(ADRESSE, { method: 'post', payload: message, contentType: 'text/plain; charset=utf-8', muteHttpExceptions: true });
  const code = reponse.getResponseCode();
  console.log('Envoi à l\'application : ' + evenements.length + ' rendez-vous, réponse ' + code + (code === 200 ? ' (OK)' : ' : ' + reponse.getContentText().slice(0, 200)));
  if (code !== 200) throw new Error('L\'envoi à l\'application a échoué (code ' + code + ').');
}
