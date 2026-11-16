'use strict';

const fmt = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

// Construit le message à partir du modèle et du contexte. Fonction pure -> testable.
function buildEmail(template, ctx, appUrl) {
  const link = ctx.book_id ? `${appUrl}/#/books/${ctx.book_id}` : `${appUrl}/#/me`;
  switch (template) {
    case 'loan.confirmed':
      return {
        subject: `Emprunt confirmé : ${ctx.title}`,
        text: `Bonjour ${ctx.user_name},\n\nVous avez emprunté « ${ctx.title} » (${ctx.author}).\nÀ rendre au plus tard le ${fmt(ctx.due_at)}.\n\n${link}`,
      };
    case 'loan.reminder':
      return {
        subject: `Rappel : « ${ctx.title} » à rendre le ${fmt(ctx.due_at)}`,
        text: `Bonjour ${ctx.user_name},\n\nPetit rappel : « ${ctx.title} » est à rendre le ${fmt(ctx.due_at)}.\n\n${link}`,
      };
    case 'loan.overdue':
      return {
        subject: `Retard : « ${ctx.title} » devait être rendu le ${fmt(ctx.due_at)}`,
        text: `Bonjour ${ctx.user_name},\n\n« ${ctx.title} » devait être rendu le ${fmt(ctx.due_at)}.\nMerci de le rapporter rapidement : vous ne pouvez plus emprunter tant que ce retard n'est pas régularisé.\n\n${link}`,
      };
    case 'reservation.available':
      return {
        subject: `Votre réservation est disponible : ${ctx.title}`,
        text: `Bonjour ${ctx.user_name},\n\n« ${ctx.title} » vous attend. Il est mis de côté jusqu'au ${fmt(ctx.expires_at)}.\n\n${link}`,
      };
    case 'reservation.expired':
      return {
        subject: `Réservation expirée : ${ctx.title}`,
        text: `Bonjour ${ctx.user_name},\n\nVous n'êtes pas venu chercher « ${ctx.title} » à temps : la réservation a expiré.\n\n${link}`,
      };
    case 'import.done':
      return {
        subject: `Import du catalogue terminé : ${ctx.created_count} ouvrage(s) ajouté(s)`,
        text: `Fichier : ${ctx.filename}\nAjoutés : ${ctx.created_count}\nIgnorés (ISBN déjà présent) : ${ctx.skipped_count}\n${ctx.errors ? `\nLignes en erreur :\n${ctx.errors}\n` : ''}\n${appUrl}/#/admin`,
      };
    default:
      throw new Error(`Modèle inconnu : ${template}`);
  }
}

// Contexte (destinataire + données) selon l'objet concerné
async function loadContext(db, data) {
  if (data.loanId) {
    const { rows } = await db.query(
      `SELECT l.*, b.title, b.author, u.name AS user_name, u.email
       FROM loans l JOIN books b ON b.id = l.book_id JOIN users u ON u.id = l.user_id WHERE l.id = $1`,
      [data.loanId],
    );
    return rows[0];
  }
  if (data.reservationId) {
    const { rows } = await db.query(
      `SELECT r.*, b.title, b.author, u.name AS user_name, u.email
       FROM reservations r JOIN books b ON b.id = r.book_id JOIN users u ON u.id = r.user_id WHERE r.id = $1`,
      [data.reservationId],
    );
    return rows[0];
  }
  if (data.importId) {
    const { rows } = await db.query(
      'SELECT i.*, u.name AS user_name, u.email FROM imports i JOIN users u ON u.id = i.uploaded_by WHERE i.id = $1',
      [data.importId],
    );
    return rows[0];
  }
  return undefined;
}

function emailJob({ db, mailer, config, logger }) {
  return async (job) => {
    const { template } = job.data;
    const ctx = await loadContext(db, job.data);
    if (!ctx) return { skipped: 'not_found' };
    const msg = buildEmail(template, ctx, config.appUrl);
    await mailer.sendMail({ from: config.smtp.from, to: ctx.email, subject: msg.subject, text: msg.text });
    logger.info({ template, to: 'redacted' }, 'e-mail envoyé');
    return { sent: 1 };
  };
}

module.exports = { emailJob, buildEmail };
