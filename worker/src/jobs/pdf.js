'use strict';
const PDFDocument = require('pdfkit');

const STATUS = { active: 'En cours', overdue: 'En retard', returned: 'Rendu' };
const d = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '—');

// Historique d'emprunts d'un membre en PDF (Buffer). Fonction pure -> testable.
function renderLoanHistoryPdf(user, loans) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Historique des emprunts — ${user.name}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('Historique des emprunts');
    doc.moveDown(0.3).fontSize(11).fillColor('#555').text(`${user.name} — ${user.email}`);
    const current = loans.filter((l) => !l.returned_at).length;
    doc.text(`${loans.length} emprunt(s) au total, dont ${current} en cours`);
    doc.moveDown();

    const cols = [50, 250, 380, 450];
    doc.fillColor('#000').fontSize(9).font('Helvetica-Bold');
    const hy = doc.y;
    ['Ouvrage', 'Emprunté le', 'Retour prévu', 'Statut'].forEach((h, i) => doc.text(h, cols[i], hy));
    doc.y = hy + 16;
    doc.font('Helvetica');
    for (const l of loans) {
      if (doc.y > 760) doc.addPage();
      const y = doc.y;
      doc.text(`${l.title} — ${l.author}`.slice(0, 60), cols[0], y, { width: 190 });
      const h = doc.y;
      doc.text(d(l.borrowed_at), cols[1], y);
      doc.text(d(l.due_at), cols[2], y);
      doc.fillColor(l.status === 'overdue' ? '#c0392b' : '#000').text(
        l.returned_at ? `Rendu le ${d(l.returned_at)}` : STATUS[l.status],
        cols[3],
        y,
      );
      doc.fillColor('#000');
      doc.y = Math.max(h, doc.y) + 4;
    }
    doc.moveDown(2).fontSize(8).fillColor('#999').text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 50);
    doc.end();
  });
}

function pdfJob({ db, storage, config, logger }) {
  return async (job) => {
    const { exportId } = job.data;
    const { rows } = await db.query(
      'SELECT e.*, u.name, u.email FROM exports e JOIN users u ON u.id = e.user_id WHERE e.id = $1',
      [exportId],
    );
    const exp = rows[0];
    if (!exp) return { skipped: 'export_deleted' };
    try {
      const loans = await db.query(
        `SELECT l.*, b.title, b.author FROM loans l JOIN books b ON b.id = l.book_id
         WHERE l.user_id = $1 ORDER BY l.borrowed_at DESC`,
        [exp.user_id],
      );
      const pdf = await renderLoanHistoryPdf({ name: exp.name, email: exp.email }, loans.rows);
      const key = `exports/${exportId}.pdf`;
      await storage.put(config.storage.attachmentsBucket, key, pdf, 'application/pdf');
      await db.query("UPDATE exports SET status = 'done', object_key = $1, finished_at = now() WHERE id = $2", [
        key,
        exportId,
      ]);
      logger.info({ exportId, bytes: pdf.length }, 'export PDF généré');
      return { key, bytes: pdf.length };
    } catch (err) {
      if (job.attemptsMade + 1 >= (job.opts.attempts || 1)) {
        await db.query("UPDATE exports SET status = 'failed', error = $1, finished_at = now() WHERE id = $2", [
          String(err.message).slice(0, 500),
          exportId,
        ]);
      }
      throw err;
    }
  };
}

module.exports = { pdfJob, renderLoanHistoryPdf };
