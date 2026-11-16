// Petits composants partagés
export function Cover({ book, size = 'md' }) {
  if (book.has_cover) {
    return <img className={`cover cover-${size}`} src={`/api/books/${book.id}/cover?v=${book.updated_at}`} alt="" />;
  }
  // Couverture générée : couleur dérivée du titre
  const hue = [...book.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <div className={`cover cover-${size} cover-placeholder`} style={{ '--hue': hue }}>
      <span>{book.title}</span>
      <small>{book.author}</small>
    </div>
  );
}

export function Availability({ book }) {
  if (book.available_copies > 0) {
    return (
      <span className="badge ok">
        {book.available_copies} / {book.total_copies} disponible{book.available_copies > 1 ? 's' : ''}
      </span>
    );
  }
  return <span className="badge ko">Indisponible</span>;
}
