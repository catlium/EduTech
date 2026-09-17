/* Renders a TEXT answer: prose as normal text, fenced (```) segments as
 * monospace blocks so ASCII-art diagrams keep their alignment. Used by the
 * question preview and the export preview so both read the same. */
export function AnswerText({ text, className }: { text: string; className?: string }) {
  const parts = text.split('```');
  return (
    <div className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre
            key={i}
            className="my-1 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs leading-snug"
          >
            {part.replace(/^[a-zA-Z0-9_-]*\n/, '').replace(/\n$/, '')}
          </pre>
        ) : (
          part.trim().length > 0 && (
            <p key={i} className="whitespace-pre-wrap text-sm">
              {part}
            </p>
          )
        ),
      )}
    </div>
  );
}
