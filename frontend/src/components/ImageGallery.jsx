import { useEffect, useRef, useState } from 'react'
import Img from './Img'
import { ChevronLeft, ChevronRight, Images } from 'lucide-react'
import Button from './Button'
import Modal from './Modal'
import { cx } from '../utils/ui'

const tilePlacement = ['row-span-2', '', '', '', '']
const navButton = 'hidden size-10 place-items-center rounded-full bg-mist transition-colors hover:bg-line sm:grid'

/** Desktop: 5-photo mosaic. Mobile: swipe carousel. Both open a lightbox. */
export default function ImageGallery({ images, title }) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [slide, setSlide] = useState(0)
  const trackRef = useRef(null)

  const show = (i) => {
    setIndex(i)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return undefined
    const step = (dir) => setIndex((i) => (i + dir + images.length) % images.length)
    const onKey = (e) => {
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, images.length])

  const step = (dir) => setIndex((i) => (i + dir + images.length) % images.length)

  const onScroll = () => {
    const el = trackRef.current
    if (el) setSlide(Math.round(el.scrollLeft / el.clientWidth))
  }

  return (
    <section aria-label={`${title} photos`} className="relative">
      {/* Tablet / desktop mosaic */}
      <div className="relative hidden h-[clamp(300px,42vw,480px)] grid-cols-[2fr_1fr_1fr] grid-rows-2 gap-2 overflow-hidden rounded-panel md:grid">
        {images.slice(0, 5).map((img, i) => (
          <button
            type="button"
            key={img.src}
            onClick={() => show(i)}
            aria-label={`Open photo ${i + 1} of ${images.length}`}
            className={cx('overflow-hidden bg-mist p-0', tilePlacement[i])}
          >
            <Img
              src={img.src}
              alt={`${title}: ${img.alt}`}
              eager={i === 0}
              className="size-full object-cover transition duration-700 hover:scale-105 hover:brightness-95"
            />
          </button>
        ))}
        <Button variant="secondary" size="sm" onClick={() => show(0)} className="absolute right-4 bottom-4">
          <Images size={16} aria-hidden="true" /> Show all photos
        </Button>
      </div>

      {/* Mobile swipe carousel */}
      <div className="relative md:hidden">
        <div
          ref={trackRef}
          onScroll={onScroll}
          tabIndex={0}
          aria-label="Photo carousel"
          className="flex snap-x snap-mandatory overflow-x-auto rounded-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((img, i) => (
            <Img
              key={img.src}
              src={img.src}
              alt={`${title}: ${img.alt}`}
              eager={i === 0}
              className="aspect-4/3 flex-[0_0_100%] snap-center object-cover"
            />
          ))}
        </div>
        <span aria-hidden="true" className="absolute right-3 bottom-3 rounded-full bg-lagoon-900/80 px-2.5 py-0.5 text-[0.8125rem] font-semibold text-white">
          {slide + 1} / {images.length}
        </span>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`${title}: photo ${index + 1} of ${images.length}`} size="full">
        <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[auto_1fr_auto]">
          <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className={navButton}>
            <ChevronLeft />
          </button>
          <img src={images[index].src} alt={`${title}: ${images[index].alt}`} className="max-h-[68vh] w-full rounded-card bg-mist object-contain" />
          <button type="button" onClick={() => step(1)} aria-label="Next photo" className={navButton}>
            <ChevronRight />
          </button>
        </div>
      </Modal>
    </section>
  )
}
