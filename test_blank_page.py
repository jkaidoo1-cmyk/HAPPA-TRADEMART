from playwright.sync_api import sync_playwright

def test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        errors = []
        page.on("pageerror", lambda err: errors.append(f"PageError: {err}"))
        page.on("console", lambda msg: errors.append(f"Console {msg.type}: {msg.text}") if msg.type in ['error', 'warning'] else None)
        
        print("Navigating to localhost:8080...")
        page.goto("http://localhost:8080/")
        page.wait_for_timeout(2000)
        
        print("Clicking a product...")
        # Find a product card and click it
        product_cards = page.locator(".product-card").all()
        if product_cards:
            product_cards[0].click()
            page.wait_for_timeout(2000)
        else:
            print("No product cards found on home page")
            
        print("Clicking a store...")
        page.goto("http://localhost:8080/#stores")
        page.wait_for_timeout(2000)
        store_cards = page.locator(".card").all()
        if store_cards:
            store_cards[0].click()
            page.wait_for_timeout(2000)
            
        print("Errors collected:")
        for err in errors:
            print(err)
            
        browser.close()

test()
