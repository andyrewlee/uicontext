# UI Context

Context augmentation for your AI agents via copy and paste. Click on elements via Chrome Extension to either extract text or component screenshot to your context library. Access your context library on the web where you can copy the context to your clipboard to paste it into your AI agent.

**Chrome Extension**
<img width="1345" height="849" alt="image" src="https://github.com/user-attachments/assets/28f9aa35-ba2e-4591-b574-91f09e0387da" />

**Web Dashboard**
<img width="1345" height="880" alt="image" src="https://github.com/user-attachments/assets/65d5f2b7-8f86-4689-b710-d743f6448d7e" />


There are major benefits to saving context via Chrome Extension. Even if the web page doesn't support "copy as Markdown" or is a protected web page, Chrome Extension is able to extract required information unlike other tools in the market that require the website to be public and/or allow bots.

UI Context has two main modes:
* Design Mode: when you want to select a specific component on the website to either clone/remix
* Text Mode: when you want to select a portion of the website and extract just the text

## Design Mode

<img width="1342" height="846" alt="image" src="https://github.com/user-attachments/assets/47866ea1-d1a9-4dcf-acb8-12ebcd2d7553" />

Click on any UI element on any website to add it to your context library. Once an UI element is clicked, the following happens:
1. Screenshot along with metadata (styles, HTML) are saved to the database.
2. Data regarding the UI element is piped through Gemini 2.5 Flash to generate a concise prompt that also contains a URL to the screenshot.
3. This prompt can be accessed at any time on dashboard. Easy as clicking Copy AI output.

## Text Mode

<img width="1342" height="827" alt="image" src="https://github.com/user-attachments/assets/23fac998-bda6-4d68-9d45-6138e2ff10c8" />

Click on any UI element on any website and it will do the following:
1. Save the HTML of the element as well as all of the child elements
2. Extract just the text and save it to context library
3. This text can be accessed at any time on dashboard. Easy as clicking Copy Text.
   
