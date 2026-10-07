import { useContext } from 'react'
import { FavouritesContext } from '../context/favourites-context'

/** { status, isSaved(propertyId), toggle(propertyId), isPending(propertyId), reload, error, items }.
 *  `toggle` sends signed-out visitors to the login page and resolves `{needsLogin: true}`; on failure it resolves `{error}` after undoing the change. */
export default function useFavourites() {
  return useContext(FavouritesContext)
}
