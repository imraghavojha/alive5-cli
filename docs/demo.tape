# Records docs/media/demo.gif with Charm's VHS: `vhs docs/demo.tape`.
# It drives the offline demo, so it never touches a real account.
Output docs/media/demo.gif

Set Shell "bash"
Set FontFamily "JetBrains Mono"
Set FontSize 16
Set Width 1280
Set Height 760
Set Padding 20
Set TypingSpeed 90ms
Set Theme { "name": "Alive5", "background": "#111011", "foreground": "#e4e4e7", "cursor": "#eb5124", "selection": "#343033", "black": "#111011", "red": "#eb5124", "green": "#28c840", "yellow": "#febc2e", "blue": "#7aa2f7", "magenta": "#ff936b", "cyan": "#a09a95", "white": "#e4e4e7", "brightBlack": "#6d6669", "brightRed": "#ff936b", "brightGreen": "#28c840", "brightYellow": "#febc2e", "brightBlue": "#7aa2f7", "brightMagenta": "#ff936b", "brightCyan": "#a09a95", "brightWhite": "#ffffff" }

Hide
Type "COLORTERM=truecolor node scripts/tui-demo.mjs" Enter
Sleep 1s
Show

# Home: the banner, the menu, and last week's conversations.
Sleep 2.5s
Tab Sleep 700ms
Down Sleep 700ms
Enter Sleep 2.5s

# Reply straight from the transcript.
Type "r" Sleep 1.2s
Enter Sleep 1s
Type "Morgan" Sleep 800ms
Enter Sleep 1.2s
Type "Yes, the order number is all they need." Sleep 1.5s
Enter Sleep 2.5s
Escape Sleep 400ms
Escape Sleep 400ms
Escape Sleep 400ms
Escape Sleep 800ms

# Ctrl+K finds any action; contacts filter as you type.
Ctrl+K Sleep 800ms
Type "contacts" Sleep 800ms
Enter Sleep 1.5s
Down Sleep 300ms
Down Sleep 300ms
Down Sleep 1s
Type "/hana" Sleep 1s
Enter Sleep 2s
Escape Sleep 400ms
Escape Sleep 1s
Type "q"
Sleep 500ms
