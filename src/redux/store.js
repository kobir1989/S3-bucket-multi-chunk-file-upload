import { configureStore } from '@reduxjs/toolkit';
import { baseApi } from '../api/apiSlice';

const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({}).concat(baseApi.middleware),
});

export default store;
