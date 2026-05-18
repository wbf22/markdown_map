# Getting Started

Place `.md` files and images in the same directory as this app.

## Tips

1. Use `#` headings for card titles
2. Cards are **draggable** - just grab the header
3. Click any card to open the side panel editor
4. Auto-save saves your changes as you type

## Code Example

```javascript
const cards = await invoke("read_directory");
cards.forEach(card => {
  console.log(card.name);
});
```
