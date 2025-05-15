import './App.css';
import React, { useState } from 'react';
import pLimit from 'p-limit';

const API_BASE_URL = 'https://testadmin-copy2.nitex.com/api/core';
const TOKEN =
  'Bearer eyJhbGciOiJIUzUxMiIsInppcCI6IkdaSVAifQ.H4sIAAAAAAAA_z3OXwuCMBQF8O9ynyX8k0k-FVQglE8-FK2HiUsvzG3MTSzxuzcVejv87j1wRuhsCSmMBGzHdPFRjEBK4Hi6ZTkBb-Ur6xnPKneJ4jByiHMOXGAtRb40WtpUGBwEGjZsULzl0qZKadlTfuG0Xt4eK1vTSI0GWef0-ZrJGI2lNYuMkxOpayrwSw1K8R-WZ8X5TmACD5AaNyLZJn4chr7vARvUCvtg52D6AX6kSArdAAAA.rcaCY9rrfrtuvsL_TOMlp3ss1Vr24x2Pb_hYUsMhCstVVbhbCutRbcMV0vpN-2bDVv2s6VWxQpwL3v0Q5KK_Sw';

const INITIAL_CHUNK_SIZE = 0.5 * 1024 * 1024; // 0.5MB for first 3 chunks
const LATER_CHUNK_SIZE = 10 * 1024 * 1024; // 5MB for later chunks
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
          PartNumber: chunk.partNumber,
          ETag: etag.replaceAll('"', ''),
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
        // const currentChunkSize = LATER_CHUNK_SIZE;
        console.log('chunkNumber =>', chunkNumber);
        console.log('currentChunkSize =>', (currentChunkSize / (1024 * 1024)).toFixed(2) + ' MB');
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
      console.log('START INIT', new Date().toLocaleTimeString());
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
      const initData = await initRes.json();
      const { uploadId, objectKey, urlList, documentId } = initData;

      if (!urlList || urlList.length === 0) {
        throw new Error('No upload URLs received from server');
      }

      const etags = new Array(numParts);
      let completedParts = 0;
      const uploadTimes = [];
      let isFirstChunkUploaded = false;

      // Upload all chunks in parallel with concurrency limit
      await Promise.all(
        chunks.map((chunk, index) =>
          limit(async () => {
            const result = await uploadChunkWithRetry(chunk, urlList[index]);
            etags[index] = result;
            uploadTimes.push(result.uploadTime);

            completedParts++;
            setUploadProgress((completedParts / numParts) * 100);

            // Increase concurrency limit after first chunk
            if (!isFirstChunkUploaded) {
              isFirstChunkUploaded = true;
              setConcurrencyLimit(5);
            }

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
          partList: etags.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })),
          documentId,
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: TOKEN,
        },
      });
      console.log('END INIT', new Date().toLocaleTimeString());
      if (!completeRes.ok) throw new Error('Failed to complete upload');

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
