interface CommandPaletteCommand {
  id: string
  label: string
  description: string
  disabled?: boolean
  run(): void
}

interface CommandPaletteProps {
  open: boolean
  commands: CommandPaletteCommand[]
  onClose(): void
}

export function CommandPalette(props: CommandPaletteProps) {
  const { open, commands, onClose } = props
  if (!open) {
    return null
  }

  return (
    <div className="command-palette" role="presentation" onMouseDown={onClose}>
      <section className="command-palette__panel" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <header className="command-palette__header">
          <strong>COMMAND PALETTE</strong>
          <button className="icon-button" onClick={onClose} type="button">x</button>
        </header>
        <div className="command-palette__list">
          {commands.map((command) => (
            <button
              className="command-palette__item"
              disabled={command.disabled}
              key={command.id}
              onClick={() => {
                command.run()
                onClose()
              }}
              type="button"
            >
              <strong>{command.label}</strong>
              <span>{command.description}</span>
            </button>
          ))}
        </div>
        <footer className="command-palette__footer">Shortcut: Ctrl/⌘ + Shift + P</footer>
      </section>
    </div>
  )
}
