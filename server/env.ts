// Loads .env before anything reads process.env. Imported first by every entry point.
import { config } from 'dotenv';

config({ quiet: true });
