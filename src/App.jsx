import './App.css';
import React, { useState } from 'react';
import pLimit from 'p-limit';

const API_BASE_URL = 'https://testadmin-copy2.nitex.com/api/core';
const TOKEN =
  'Bearer eyJhbGciOiJIUzUxMiIsInppcCI6IkdaSVAifQ.H4sIAAAAAAAA_z3OzQqCQBQF4He5a4k0829VUIFQrlwUTYsRJ70wOsM4iiW-e-MI7Q7fvQfOBF1fQAITgb5jKv9IRiAhcDzd0oyAs_KVDYynpbns9t7OIC7ZNYE1FLltNLQu0T20qNm4wfYtbJtKqcRA-YXTyr49Vu51LRRqZJ3R52shrRUWvbYyzUaEqmiLX6pRtP9hWZqf7wRmcACpNiNCP4zjIPI9B9goLURRsDUw_wDLn9tJ3QAAAA.UjUept8rkY1uUUSDm879s9_WtWdOg7N2fl6iS7Uh_CLRLDeNKTtTrrQGNb1H7WCaXgFfxt5VgcsrdcxVMun7TA';

const INITIAL_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB for first  chunks
const LATER_CHUNK_SIZE = 20 * 1024 * 1024; // 10MB for later chunks
const SWITCH_AFTER_CHUNKS = 1;

function App() {
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadTime, setUploadTime] = useState(0);
  const [concurrencyLimit, setConcurrencyLimit] = useState(1);

  const limit = pLimit(concurrencyLimit);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Add validation for file size
    if (file.size === 0) {
      setError('File is empty. Please select a valid file.');
      return;
    }

    setFile(file);
    setError(null);
  };

  // Retry logic for failed uploads
  const uploadChunkWithRetry = async (chunk, url, maxRetries = 2) => {
    while (chunk.attempts < maxRetries) {
      try {
        const startTime = performance.now();
        const res = await fetch(url, {
          method: 'PUT',
          body: chunk.blob,
        });

        // console.log('chunk =>', chunk);

        if (!res.ok) throw new Error(`Failed to upload part ${chunk.partNumber}`);

        const uploadTime = performance.now() - startTime;
        console.log(`Chunk ${chunk.partNumber} uploaded in ${uploadTime}ms`);
        setUploadTime((prev) => prev + uploadTime);
        const etag = res.headers.get('ETag');
        return {
          partNumber: chunk.partNumber,
          eTag: etag.replaceAll('"', ''),
          uploadTime,
        };
      } catch (err) {
        chunk.attempts++;
        if (chunk.attempts === maxRetries) throw err;
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, chunk.attempts)));
      }
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    try {
      setIsUploading(true);
      setError(null);
      setUploadProgress(0);
      setConcurrencyLimit(1); // Reset to initial limit of 1

      if (file.size === 0) {
        throw new Error('Cannot upload an empty file');
      }

      const chunks = [];
      let start = 0;

      while (start < file.size) {
        const chunkNumber = chunks.length + 1;
        const currentChunkSize =
          chunkNumber <= SWITCH_AFTER_CHUNKS ? INITIAL_CHUNK_SIZE : LATER_CHUNK_SIZE;
        const end = Math.min(start + currentChunkSize, file.size);

        chunks.push({
          blob: file.slice(start, end),
          start,
          end,
          attempts: 0,
          partNumber: chunkNumber,
        });
        start = end;
      }
      const numParts = chunks.length;
      setUploadTime(0);
      // Init upload
      const initRes = await fetch(`${API_BASE_URL}/doc/multipart-upload/initiate`, {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          docMimeType: file.type,
          partCount: numParts,
          documentType: 'PRODUCT_DESIGN',
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: TOKEN,
        },
      });

      if (!initRes.ok) throw new Error('Failed to initiate upload');
      console.log('START TIME => ', new Date().toLocaleTimeString());
      const initData = await initRes.json();
      const { uploadId, objectKey, urlList, documentId } = initData;

      if (!urlList || urlList.length === 0) {
        throw new Error('No upload URLs received from server');
      }

      const etags = new Array(numParts);
      let completedParts = 0;
      const uploadTimes = [];

      // Upload the first chunk alone
      const firstChunkResult = await uploadChunkWithRetry(chunks[0], urlList[0]);
      console.log('firstChunkResult', firstChunkResult);
      if (firstChunkResult) {
        const delay = async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          console.log('Timer Started =>');
        };
        await delay();
      }
      etags[0] = firstChunkResult;
      uploadTimes.push(firstChunkResult.uploadTime);
      completedParts++;
      setUploadProgress((completedParts / numParts) * 100);

      // Now upload the rest with concurrency limit 3
      const restLimit = pLimit(3);
      await Promise.all(
        chunks.slice(1).map((chunk, idx) =>
          restLimit(async () => {
            const result = await uploadChunkWithRetry(chunk, urlList[idx + 1]);
            etags[idx + 1] = result;
            uploadTimes.push(result.uploadTime);
            completedParts++;
            setUploadProgress((completedParts / numParts) * 100);
            return result;
          })
        )
      );

      // Complete the upload
      const completeRes = await fetch(`${API_BASE_URL}/doc/multipart-upload/complete`, {
        method: 'POST',
        body: JSON.stringify({
          key: objectKey,
          uploadId,
          partList: etags.map(({ partNumber, eTag }) => ({ partNumber, eTag })),
          documentId,
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: TOKEN,
        },
      });
      if (!completeRes.ok) throw new Error('Failed to complete upload');
      console.log('END TIME => ', new Date().toLocaleTimeString());
      const { location } = await completeRes.json();
      alert(`Upload complete! File available at: ${location}`);
      setFile(null);
      setUploadProgress(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <main className='upload-container'>
      <section className='upload-section'>
        <h1>File Upload</h1>
        <form onSubmit={handleUpload}>
          <div className='file-input-container'>
            <input
              type='file'
              onChange={handleFileChange}
              name='file'
              id='file'
              disabled={isUploading}
            />
            {file && (
              <div className='file-info'>
                <p>Selected file: {file.name}</p>
                <p>Size: {(file.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            )}
          </div>
          {uploadTime > 0 && (
            <div className='upload-time'>Upload time: {(uploadTime / 1000).toFixed(2)}s</div>
          )}
          {error && <div className='error-message'>{error}</div>}

          {isUploading && (
            <div className='progress-container'>
              <div className='progress-bar' style={{ width: `${uploadProgress}%` }} />
              <span>{Math.round(uploadProgress)}%</span>
            </div>
          )}

          <div className='button-container'>
            <button type='submit' disabled={!file || isUploading}>
              {isUploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default App;
