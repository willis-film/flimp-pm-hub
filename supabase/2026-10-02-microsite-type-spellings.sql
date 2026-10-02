update product_types
   set value = case value
     when 'Microsite Single-Page' then 'Microsite - Single Page'
     when 'Microsite Multi-Page'  then 'Microsite - Multi Page'
   end
 where value in ('Microsite Single-Page', 'Microsite Multi-Page');

update product_options
   set product_type = case product_type
     when 'Microsite Single-Page' then 'Microsite - Single Page'
     when 'Microsite Multi-Page'  then 'Microsite - Multi Page'
   end
 where product_type in ('Microsite Single-Page', 'Microsite Multi-Page');

update product_options
   set product_type = 'Microsite - Single Page',
       sort_order = (select coalesce(max(sort_order), 0) + 1
                       from product_options
                      where kind = 'tier' and product_type = 'Microsite - Single Page')
 where kind = 'tier'
   and product_type = 'Microsite - Multi Page'
   and value = 'Mobile Contact Wallet';

update product_options
   set product_type = 'Microsite - Single Page',
       sort_order = (select coalesce(max(sort_order), 0) + 1
                       from product_options
                      where kind = 'tier' and product_type = 'Microsite - Single Page')
 where kind = 'tier'
   and product_type = 'Microsite - Multi Page'
   and value = 'Mobile Contact Wallet Plus';

update kickoff_content
   set product_types = array_replace(
         array_replace(product_types, 'Microsite Single-Page', 'Microsite - Single Page'),
         'Microsite Multi-Page', 'Microsite - Multi Page')
 where product_types && array['Microsite Single-Page', 'Microsite Multi-Page'];
