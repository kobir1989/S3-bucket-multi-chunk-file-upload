import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

const BASE_URL = 'http://localhost:5000';
const baseQuery = fetchBaseQuery({
  baseUrl: BASE_URL,
});

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: [],
  endpoints: () => ({}),
});

export default baseApi;
