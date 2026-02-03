const { chromium } = require('playwright');
require('dotenv').config();
const supabase = require('./supabase');
const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * DAT Automation Script - Form Filling Mode
 */

async function downloadPhoto(url, filename) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filename);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(filename);
            });
        }).on('error', (err) => {
            fs.unlink(filename, () => { });
            reject(err);
        });
    });
}

async function runAutomation() {
    console.log('🚀 Starting Form-Filling Automation...');

    const { data: valuations, error } = await supabase
        .from('anonymized_valuations')
        .select('*')
        .or('feedback.is.null,feedback.eq.NULL')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('❌ Supabase Error:', error.message);
        return;
    }

    if (!valuations || valuations.length === 0) {
        console.log('📭 No pending valuations.');
        return;
    }

    for (const valuation of valuations) {
        console.log(`\n🔄 Processing ID: ${valuation.id} (${valuation.registration_number})`);

        const browser = await chromium.launch({
            headless: process.env.HEADLESS !== 'false',
            slowMo: 100
        });
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();

        try {
            console.log('🔑 Logging in...');
            await page.goto('https://www.datgroup.com/myClaim/index.jsp', { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Login
            await page.fill('#login-customerNumber', process.env.DAT_CUSTOMER_NUMBER);
            await page.fill('#login-userLogin', process.env.DAT_USER_LOGIN);
            await page.fill('#login-password', process.env.DAT_PASSWORD);
            await page.click('#login-submit');

            // Network selection
            try {
                await page.waitForSelector('#login-networkType', { timeout: 10000 });
                await page.selectOption('#login-networkType', process.env.DAT_NETWORK || 'DAT_IB');
                await page.click('#login-submit');
            } catch (e) { }

            console.log('⏳ Waiting for dashboard...');
            await page.waitForSelector('.button-openClaimButton', { timeout: 30000 });

            // Click "New order"
            await page.click('.button-openClaimButton');
            await page.waitForSelector('li[aria-controls="tab-contractOpening"]', { timeout: 20000 });

            // --- TAB: Apertura ---
            console.log('📂 Filling "Apertura" tab...');
            await page.fill('#customField-input-referenceNumber', valuation.order_number || '');
            await page.fill('#customField-input-address_firstName', valuation.first_name || '');
            await page.fill('#customField-input-address_surname', valuation.last_name || '');

            // Photos
            if (valuation.photos && Array.isArray(valuation.photos)) {
                console.log(`📸 Processing ${valuation.photos.length} photos...`);
                const photoFiles = [];
                for (let i = 0; i < Math.min(valuation.photos.length, 10); i++) {
                    const localPath = path.join(__dirname, `temp_photo_${valuation.id}_${i}.jpg`);
                    try {
                        await downloadPhoto(valuation.photos[i], localPath);
                        photoFiles.push(localPath);
                    } catch (e) { console.error('   Error downloading photo:', e.message); }
                }

                if (photoFiles.length > 0) {
                    try {
                        console.log('📤 Uploading to "Anonymized photos"...');
                        const photoHeader = page.locator('h2.frameHeader:has-text("Anonymized photos")');
                        const photoContainer = page.locator('.document.layout-frame').filter({ has: photoHeader });
                        await photoHeader.scrollIntoViewIfNeeded();
                        await photoContainer.locator('.uploadZone-fileInput').setInputFiles(photoFiles);
                        console.log(`✅ Uploaded ${photoFiles.length} photos.`);
                        await page.waitForTimeout(3000);
                    } catch (e) { console.error('   Upload Error:', e.message); }
                }
                photoFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
            }

            // --- TAB: Vehicle Selection ---
            console.log('🚗 Moving to "Vehicle selection" tab...');
            const vehicleTab = page.locator('li[aria-controls="tab-vehicleSelection"] a, li:has-text("Vehicle selection") a').first();
            await vehicleTab.click({ force: true });
            await page.waitForTimeout(7000);

            // Heavy-duty filler function with visual verification
            const robustFill = async (locator, value, fieldName) => {
                try {
                    if (await locator.count() > 0 && await locator.isVisible()) {
                        await locator.scrollIntoViewIfNeeded();
                        await page.waitForTimeout(500);

                        // Take screenshot before
                        const screenshotName = `before_${fieldName.replace(/[^a-z0-9]/gi, '_')}.png`;
                        await page.screenshot({ path: screenshotName });
                        console.log(`   📸 Screenshot saved: ${screenshotName}`);

                        await locator.click({ force: true });
                        await page.waitForTimeout(300);

                        // Clear field multiple times to ensure it's empty
                        await locator.clear();
                        await page.waitForTimeout(200);
                        await locator.fill('');
                        await page.waitForTimeout(200);

                        // Method 1: Simulate real typing with blur/focus
                        console.log(`   Typing "${value}" into ${fieldName}...`);
                        await locator.focus();
                        await page.waitForTimeout(200);
                        await locator.pressSequentially(value, { delay: 100 });
                        await page.waitForTimeout(2000); // Wait longer for any JS to process

                        // Trigger blur event (often required for validation)
                        await locator.blur();
                        await page.waitForTimeout(500);

                        // Check if value stuck (first check)
                        let actualValue = await locator.inputValue();
                        console.log(`   First check: field value is "${actualValue}"`);

                        if (actualValue === value) {
                            console.log(`   ✅ Successfully filled ${fieldName} with "${value}"`);
                            // Take screenshot after success
                            const afterScreenshot = `after_${fieldName.replace(/[^a-z0-9]/gi, '_')}.png`;
                            await page.screenshot({ path: afterScreenshot });
                            console.log(`   📸 Screenshot saved: ${afterScreenshot}`);
                            await page.waitForTimeout(1000); // Extra wait to ensure it persists

                            // Final verification
                            const finalValue = await locator.inputValue();
                            if (finalValue === value) {
                                console.log(`   ✅ Final verification passed: "${finalValue}"`);
                                return true;
                            } else {
                                console.log(`   ⚠️ Value changed after delay! Now: "${finalValue}"`);
                            }
                        }

                        console.log(`   ⚠️ Typed value didn't stick for ${fieldName}. Trying DOM injection...`);

                        // Method 2: DOM injection + Comprehensive Event Dispatch
                        await locator.click({ force: true });
                        await page.waitForTimeout(200);
                        await locator.evaluate((el, val) => {
                            el.value = val;
                            // Trigger all possible events
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            el.dispatchEvent(new Event('blur', { bubbles: true }));
                            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
                            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                            el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
                        }, value);

                        await page.waitForTimeout(2000);
                        await locator.blur();
                        await page.waitForTimeout(500);

                        actualValue = await locator.inputValue();
                        console.log(`   Second check: field value is "${actualValue}"`);

                        if (actualValue === value) {
                            console.log(`   ✅ Successfully filled ${fieldName} (DOM Injection) with "${value}"`);
                            const afterScreenshot = `after_${fieldName.replace(/[^a-z0-9]/gi, '_')}.png`;
                            await page.screenshot({ path: afterScreenshot });
                            await page.waitForTimeout(1000);

                            // Final verification
                            const finalValue = await locator.inputValue();
                            if (finalValue === value) {
                                console.log(`   ✅ Final verification passed: "${finalValue}"`);
                                return true;
                            } else {
                                console.log(`   ⚠️ Value changed after delay! Now: "${finalValue}"`);
                            }
                        }

                        // Method 3: Fill method with events
                        console.log(`   ⚠️ DOM injection failed. Trying fill method...`);
                        await locator.click({ force: true });
                        await page.waitForTimeout(200);
                        await locator.fill(value);
                        await page.waitForTimeout(1000);
                        await locator.blur();
                        await page.waitForTimeout(1000);

                        actualValue = await locator.inputValue();
                        console.log(`   Third check: field value is "${actualValue}"`);

                        if (actualValue === value) {
                            console.log(`   ✅ Successfully filled ${fieldName} (Fill method) with "${value}"`);
                            const afterScreenshot = `after_${fieldName.replace(/[^a-z0-9]/gi, '_')}.png`;
                            await page.screenshot({ path: afterScreenshot });
                            await page.waitForTimeout(1000);

                            // Final verification
                            const finalValue = await locator.inputValue();
                            if (finalValue === value) {
                                console.log(`   ✅ Final verification passed: "${finalValue}"`);
                                return true;
                            } else {
                                console.log(`   ⚠️ Value changed after delay! Now: "${finalValue}"`);
                            }
                        }
                    }
                } catch (e) { console.log(`   Internal error filling ${fieldName}:`, e.message); }
                return false;
            };

            console.log('📝 Filling vehicle details...');

            // --- MILEAGE ---
            if (valuation.mileage !== undefined && valuation.mileage !== null) {
                console.log(`   attempting to fill mileage: ${valuation.mileage}`);
                let mileageFilled = false;
                const mileageVal = valuation.mileage.toString();

                // Strategy 1: Text Proximity (This worked for Registration!)
                if (!mileageFilled) {
                    try {
                        console.log('   Trying Text Proximity for Kilometraje...');
                        const container = page.locator('div, tr, td, p, fieldset, label').filter({ hasText: /Kilometraje|Mileage/i }).filter({ has: page.locator('input') }).last();
                        const input = container.locator('input').first();
                        if (await robustFill(input, mileageVal, 'Mileage (Proximity)')) mileageFilled = true;
                    } catch (e) { console.log('   Text Proximity failed:', e.message); }
                }

                // Strategy 2: Label
                if (!mileageFilled) {
                    console.log('   Trying Label match...');
                    mileageFilled = await robustFill(page.getByLabel(/Kilometraje|Mileage/i).first(), mileageVal, 'Mileage (Label)');
                }

                // Strategy 3: Common Selectors
                if (!mileageFilled) {
                    console.log('   Trying known selectors...');
                    const mileageSelectors = [
                        '#customField-input-vehicle_mileage',
                        '#customField-input-mileageOdometer',
                        '#customField-input-vehicle_mileage2',
                        'input[name*="mileage" i]',
                        'input[name*="kilometraje" i]',
                        'input[name*="odometer" i]',
                        'input[placeholder*="Kilometraje" i]',
                        'input[placeholder*="Mileage" i]'
                    ];
                    for (const sel of mileageSelectors) {
                        if (await robustFill(page.locator(sel).first(), mileageVal, `Mileage (Selector: ${sel})`)) {
                            mileageFilled = true;
                            break;
                        }
                    }
                }

                // Strategy 4: Find ANY input near "Kilometraje" text
                if (!mileageFilled) {
                    try {
                        console.log('   Trying to find any input near Kilometraje text...');
                        const kmText = page.locator('text=/Kilometraje/i').first();
                        if (await kmText.count() > 0) {
                            // Get the parent row/container and find input
                            const parent = kmText.locator('xpath=ancestor::tr | ancestor::div[@class] | ancestor::td').first();
                            const nearbyInput = parent.locator('input[type="text"], input:not([type])').first();
                            if (await robustFill(nearbyInput, mileageVal, 'Mileage (Nearby Input)')) mileageFilled = true;
                        }
                    } catch (e) { console.log('   Nearby input search failed:', e.message); }
                }

                if (!mileageFilled) console.warn('   ⚠️ Failed to fill Mileage field.');
            }

            // --- REGISTRATION ---
            if (valuation.registration_number) {
                console.log(`   attempting to fill registration: ${valuation.registration_number}`);
                let regFilled = false;
                const regVal = valuation.registration_number;

                if (!regFilled) regFilled = await robustFill(page.getByLabel(/Matrícula|Matricula|Registration|License|License Plate/i).first(), regVal, 'Registration (Label)');

                if (!regFilled) {
                    const regSelectors = [
                        '#customField-input-vehicle_registration',
                        '#txtLicenceNumberEs',
                        '#txtLicenceNumber',
                        '#customField-input-LicenseNumber',
                        'input[name*="registration" i]',
                        'input[name*="license" i]'
                    ];
                    for (const sel of regSelectors) {
                        if (await robustFill(page.locator(sel).first(), regVal, `Registration (Selector: ${sel})`)) {
                            regFilled = true;
                            break;
                        }
                    }
                }

                if (!regFilled) {
                    // Strategy 3: Text Proximity
                    try {
                        const container = page.locator('div, tr, p, fieldset').filter({ hasText: /Matrícula|Matricula|Registration|License/i }).filter({ has: page.locator('input') }).last();
                        const input = container.locator('input').first();
                        if (await robustFill(input, regVal, 'Registration (Proximity)')) regFilled = true;
                    } catch (e) { }
                }

                if (!regFilled) console.warn('   ⚠️ Failed to fill Registration field.');
            }


            console.log('✅ Form filling complete.');

            // Final verification before marking as success
            console.log('\n🔍 Final verification of filled fields...');
            await page.waitForTimeout(2000);

            let finalSuccess = true;
            const finalScreenshot = `final_verification_${valuation.id}.png`;
            await page.screenshot({ path: finalScreenshot, fullPage: true });
            console.log(`📸 Final screenshot saved: ${finalScreenshot}`);

            // Verify mileage field
            if (valuation.mileage !== undefined && valuation.mileage !== null) {
                try {
                    const container = page.locator('div, tr, td, p, fieldset, label').filter({ hasText: /Kilometraje|Mileage/i }).filter({ has: page.locator('input') }).last();
                    const input = container.locator('input').first();
                    const finalMileageValue = await input.inputValue();
                    console.log(`   Mileage field final value: "${finalMileageValue}" (expected: "${valuation.mileage}")`);

                    // Handle formatted numbers (e.g., "1.000" vs "1000")
                    const normalizedActual = finalMileageValue.replace(/[.,\s]/g, '');
                    const normalizedExpected = valuation.mileage.toString().replace(/[.,\s]/g, '');

                    if (normalizedActual !== normalizedExpected) {
                        console.warn(`   ⚠️ WARNING: Mileage field does not match expected value!`);
                        console.warn(`      Normalized actual: "${normalizedActual}", expected: "${normalizedExpected}"`);
                        finalSuccess = false;
                    } else {
                        console.log(`   ✅ Mileage field verified (normalized values match)`);
                    }
                } catch (e) {
                    console.warn(`   ⚠️ Could not verify mileage field: ${e.message}`);
                }
            }

            // Verify registration field
            if (valuation.registration_number) {
                try {
                    const regInput = page.locator('#txtLicenceNumberEs').first();
                    const finalRegValue = await regInput.inputValue();
                    console.log(`   Registration field final value: "${finalRegValue}" (expected: "${valuation.registration_number}")`);
                    if (finalRegValue !== valuation.registration_number) {
                        console.warn(`   ⚠️ WARNING: Registration field does not match expected value!`);
                        finalSuccess = false;
                    }
                } catch (e) {
                    console.warn(`   ⚠️ Could not verify registration field: ${e.message}`);
                }
            }

            if (finalSuccess) {
                await supabase.from('anonymized_valuations').update({ feedback: 'Success' }).eq('id', valuation.id);
                console.log('✅ Updated Supabase: Success');
            } else {
                await supabase.from('anonymized_valuations').update({ feedback: 'Failed - Fields not persisted' }).eq('id', valuation.id);
                console.log('❌ Updated Supabase: Failed - Fields did not persist');
            }


        } catch (err) {
            console.error(`❌ Failed for ${valuation.id}:`, err.message);
            await supabase.from('anonymized_valuations').update({ feedback: 'Failed' }).eq('id', valuation.id);
        } finally {
            await browser.close();
            console.log('🏁 Browser closed.');
        }
    }
}

if (require.main === module) {
    runAutomation();
}

module.exports = { runAutomation };
