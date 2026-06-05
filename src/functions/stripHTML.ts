// Block-level / line-breaking tags whose boundaries must not glue adjacent
// words together. Mastodon wraps each paragraph in <p> and uses <br>.
const BLOCK_LEVEL = 'address,article,aside,blockquote,br,dd,div,dl,dt,figure,footer,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,td,th,tr,ul'

export default function(html: string) {
  const element = document.createElement('div')
  element.innerHTML = html
  // `textContent` alone would render "<p>foo</p><p>bar</p>" as "foobar", merging
  // the two paragraphs into one unsearchable token. Insert a separator before
  // every block-level element so words across blocks stay distinct.
  element.querySelectorAll(BLOCK_LEVEL).forEach(node => {
    node.insertAdjacentText('beforebegin', ' ')
  })
  return (element.textContent || '').replace(/\s+/g, ' ').trim()
}