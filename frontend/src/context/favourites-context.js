import { createContext } from 'react'

export const FavouritesContext = createContext({
  status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  isSaved: () => false,
  toggle: async () => {},
  isPending: () => false,
  reload: () => {},
  error: null,
  items: [],
})
