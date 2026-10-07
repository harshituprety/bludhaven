// Static copy for the home page. Every statement here describes how the platform actually behaves
// (see backend/docs/API.md); there are no invented figures, people or quotes.

// EXAMPLE guest stories for the home page (components/Testimonials.jsx). They are illustrative sample wording, NOT real
// reviews: no names, no places, no ratings, and the section says so. Real reviews come from the API.
export const exampleTestimonials = [
  {
    id: 'e1',
    featured: true,
    quote:
      'A friendly note from a guest might go here: how easy it was to find the place, how well the host had prepared it, and what made the stay feel like a proper break.',
  },
  { id: 'e2', quote: 'A short remark about a home matching its photos and a price that was clear from the start.' },
  { id: 'e3', quote: 'A line about a quiet spot, a helpful host and the small touches a guest noticed.' },
  { id: 'e4', tint: true, quote: 'A comment about a comfortable bed, a well-equipped kitchen and a calm evening.' },
  { id: 'e5', quote: 'A few words about a smooth check-in and a host who answered questions quickly.' },
  { id: 'e6', quote: 'A closing thought about a stay worth repeating.' },
]

export const highlights = [
  {
    id: 'price',
    icon: 'receipt',
    title: 'The price you see is the price you pay',
    featured: true,
    text: 'Your total is worked out by our server from the number of nights and the nightly price at the moment you book. If a host changes the price later, your booking stays as it was.',
  },
  {
    id: 'verified',
    icon: 'mail',
    title: 'Bookings need a verified email',
    text: 'Only guests who have confirmed their email address can book, so hosts know who is on the other end.',
  },
  {
    id: 'reviews',
    icon: 'star',
    title: 'Reviews from real stays',
    tint: true,
    text: 'Only the guest of a completed stay can leave a review, and only one per booking.',
  },
  {
    id: 'hosts',
    icon: 'badge',
    title: 'Hosts are invited by our team',
    text: 'Host accounts are set up by the Blüdhaven team, not self-registered, so every listing comes from a host we have brought on ourselves.',
  },
]

export const faqs = [
  {
    q: 'How do I book a stay on Blüdhaven?',
    a: 'Search by destination, dates and guests, open a stay you like and choose your dates in the booking panel. You need a guest account with a verified email. Your total is calculated by our server and shown to you before you confirm.',
  },
  {
    q: 'Can I cancel or change my dates?',
    a: 'A booking cannot be edited. While it is pending or confirmed you can cancel it from My trips and book again with new dates, subject to availability.',
  },
  {
    q: 'What is included in the price?',
    a: 'The total is the number of nights multiplied by the stay’s nightly price, fixed when you book. Later changes to the nightly price do not affect a booking you have already made.',
  },
  {
    q: 'Are the photos and reviews real?',
    a: 'Hosts upload their own photos. Only the guest of a completed stay can leave a review, once per booking, and a stay’s rating is the average of its reviews. Stays rated 4.8 or higher show a Guest favourite badge.',
  },
  {
    q: 'How do I become a host?',
    a: 'Host accounts are set up by invitation from the Blüdhaven team, who also assign a subscription plan. Have a look at the plans, get in touch with the team, and once your account is ready you can add your homes with photos, amenities and a nightly price.',
  },
]
